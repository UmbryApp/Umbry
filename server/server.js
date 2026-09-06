// Umbry Server — the app's own settings/account backend.
//
// Source of truth for Umbry app state (server list, PIN, parental rules, theme prefs), keyed to
// an Umbry account (email + password). The web client and every future native client authenticate
// here and pull/push a single settings blob, so state survives a cache clear and syncs across devices.
//
// Storage: a small JSON file with atomic writes (pure JS — no native module, so this same server runs
// unchanged on Windows/macOS/Linux and bundles into a one-file installer). Passwords: argon2id via
// hash-wasm (WASM, not a native addon — keeps the standard PHC hash format, so hashes made by the old
// native-argon2 build still verify). Sessions: JWT (Bearer). The settings blob is encrypted at rest
// with AES-256-GCM (it holds media-server tokens), so the store file never contains plaintext tokens.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { argon2id, argon2Verify } from 'hash-wasm';
import jwt from 'jsonwebtoken';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_PATH = path.join(DATA_DIR, 'umbry.json');
const TOKEN_TTL = process.env.TOKEN_TTL || '30d';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

fs.mkdirSync(DATA_DIR, { recursive: true });
// Migrate a legacy store file (pre-rename) so existing data carries over to the Umbry name.
try { const __legacy = path.join(DATA_DIR, 'jellyplex.json'); if (!fs.existsSync(STORE_PATH) && fs.existsSync(__legacy)) fs.renameSync(__legacy, STORE_PATH); } catch { /* ignore */ }

// Secrets: honor env when provided (advanced/prod), otherwise auto-provision UNIQUE per-install
// secrets persisted in the data dir on first run — so a self-hosted install works with zero config
// and no two installs ever share keys. Env always wins, so an existing deployment that pins
// JWT_SECRET/ENC_KEY is unaffected.
function loadOrCreateSecrets() {
    const envJwt = process.env.JWT_SECRET;
    const envEnc = process.env.ENC_KEY;
    if (envJwt && envEnc) return { jwt: envJwt, enc: envEnc };
    const file = path.join(DATA_DIR, 'secrets.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first run */ }
    const out = {
        jwt: envJwt || saved.jwt || crypto.randomBytes(48).toString('base64'),
        enc: envEnc || saved.enc || crypto.randomBytes(32).toString('base64')
    };
    if (out.jwt !== saved.jwt || out.enc !== saved.enc) {
        try { fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 }); console.log('[umbry-server] provisioned per-install secrets ->', file); }
        catch (e) { console.error('WARN: could not persist secrets:', e.message); }
    }
    return out;
}
const __secrets = loadOrCreateSecrets();
const JWT_SECRET = __secrets.jwt;
const ENC_KEY_B64 = __secrets.enc;
const ENC_KEY = Buffer.from(ENC_KEY_B64, 'base64');
if (ENC_KEY.length !== 32) {
    console.error('FATAL: ENC_KEY must be 32 bytes, base64-encoded');
    process.exit(1);
}

// ---- storage: JSON file, atomic writes (tmp + rename). Data is tiny (a household's accounts +
// one settings row each), Node's single JS thread serializes writes — WAL/native SQLite is overkill. ----
class JsonStore {
    constructor(file) {
        this.file = file;
        this.data = { accounts: {}, emailIndex: {}, settings: {} };
        try {
            const d = JSON.parse(fs.readFileSync(file, 'utf8'));
            this.data = { accounts: d.accounts || {}, emailIndex: d.emailIndex || {}, settings: d.settings || {} };
        } catch { /* first run — start empty */ }
    }

    _persist() {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
        // Atomic replace (libuv rename replaces an existing target on Windows too). A Windows AV
        // scanner or search indexer can briefly lock the target, so retry, then fall back to copy.
        let lastErr;
        for (let i = 0; i < 5; i++) {
            try { fs.renameSync(tmp, this.file); return; }
            catch (e) { lastErr = e; const until = Date.now() + 40; while (Date.now() < until) { /* brief backoff */ } }
        }
        try { fs.copyFileSync(tmp, this.file); fs.unlinkSync(tmp); return; }
        catch { throw lastErr; }
    }

    accountByEmail(email) {
        const id = this.data.emailIndex[email];
        return id ? this.data.accounts[id] : undefined;
    }

    insertAccount(id, email, pwHash, recoveryHash, createdAt, updatedAt) {
        this.data.accounts[id] = { id, email, pw_hash: pwHash, recovery_hash: recoveryHash, created_at: createdAt, updated_at: updatedAt };
        this.data.emailIndex[email] = id;
        this._persist();
    }

    setAccountAuth(id, fields) {
        const acc = this.data.accounts[id];
        if (!acc) return;
        if (fields.pw_hash !== undefined) acc.pw_hash = fields.pw_hash;
        if (fields.recovery_hash !== undefined) acc.recovery_hash = fields.recovery_hash;
        acc.updated_at = fields.updated_at || Date.now();
        this._persist();
    }

    getSettings(accountId) { return this.data.settings[accountId]; } // { blob, version, updated_at } | undefined

    upsertSettings(accountId, blob, version, updatedAt) {
        this.data.settings[accountId] = { blob, version, updated_at: updatedAt };
        this._persist();
    }
}
const store = new JsonStore(STORE_PATH);

// ---- password hashing (argon2id via WASM; preserves the PHC string format) ----
async function hashPassword(pw) {
    return argon2id({
        password: String(pw),
        salt: crypto.randomBytes(16),
        parallelism: 1,
        iterations: 3,
        memorySize: 19456, // KiB (~19 MB, OWASP argon2id guidance)
        hashLength: 32,
        outputType: 'encoded'
    });
}
async function verifyPassword(hash, pw) {
    try { return await argon2Verify({ password: String(pw), hash }); } catch { return false; }
}

// ---- account recovery code (self-service password reset, no email/SMTP needed) ----
// A code is shown once at signup; its argon2 hash is stored like a password. Reset = email + code.
const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // omit 0/O/1/I/L to avoid ambiguity
function makeRecoveryCode() {
    const bytes = crypto.randomBytes(16);
    let s = '';
    for (let i = 0; i < 16; i++) {
        s += RC_ALPHABET[bytes[i] % RC_ALPHABET.length];
        if (i % 4 === 3 && i < 15) s += '-';
    }
    return s; // e.g. A7QK-3FRM-9XTP-W2DH
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---- at-rest encryption (iv | tag | ciphertext, base64) ----
function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}
function decrypt(b64) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const sign = (id) => jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: TOKEN_TTL });

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
await app.register(cors, {
    origin: CORS_ORIGINS.length ? CORS_ORIGINS : true,
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
});
await app.register(rateLimit, { global: false });

async function requireAuth(req, reply) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return reply.code(401).send({ error: 'unauthorized' });
    try {
        req.accountId = jwt.verify(m[1], JWT_SECRET).sub;
    } catch {
        return reply.code(401).send({ error: 'unauthorized' });
    }
    recordConn(req.accountId, req.ip, req.headers['user-agent']);
}

app.get('/', async () => ({
    service: 'umbry-server',
    status: 'ok',
    message: 'Umbry settings API — this is a backend endpoint, not a website.'
}));

app.get('/health', async () => ({ ok: true, service: 'umbry-server' }));

app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = req.body || {};
    const em = String(email || '').trim().toLowerCase();
    if (!emailRe.test(em)) return reply.code(400).send({ error: 'invalid email' });
    if (String(password || '').length < 8) return reply.code(400).send({ error: 'password must be at least 8 characters' });
    if (store.accountByEmail(em)) return reply.code(409).send({ error: 'email already registered' });
    const hash = await hashPassword(password);
    const recoveryCode = makeRecoveryCode();
    const recoveryHash = await hashPassword(normCode(recoveryCode));
    const id = randomUUID();
    const now = Date.now();
    store.insertAccount(id, em, hash, recoveryHash, now, now);
    store.upsertSettings(id, encrypt(JSON.stringify({})), 0, now);
    return { token: sign(id), email: em, recoveryCode };
});

app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = req.body || {};
    const em = String(email || '').trim().toLowerCase();
    const acc = store.accountByEmail(em);
    if (!acc) return reply.code(401).send({ error: 'invalid credentials' });
    const ok = await verifyPassword(acc.pw_hash, password);
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: sign(acc.id), email: em };
});

// Self-service reset with the recovery code shown at signup (no email/SMTP). Verifies email + code,
// sets the new password, and issues a FRESH recovery code (the used one no longer works).
app.post('/auth/reset', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, recoveryCode, newPassword } = req.body || {};
    const em = String(email || '').trim().toLowerCase();
    if (String(newPassword || '').length < 8) return reply.code(400).send({ error: 'password must be at least 8 characters' });
    const acc = store.accountByEmail(em);
    // uniform error so this can't enumerate which emails exist or have a code set
    const fail = () => reply.code(401).send({ error: 'invalid email or recovery code' });
    if (!acc || !acc.recovery_hash) return fail();
    const ok = await verifyPassword(acc.recovery_hash, normCode(recoveryCode));
    if (!ok) return fail();
    const pwHash = await hashPassword(newPassword);
    const nextCode = makeRecoveryCode();
    const nextHash = await hashPassword(normCode(nextCode));
    store.setAccountAuth(acc.id, { pw_hash: pwHash, recovery_hash: nextHash, updated_at: Date.now() });
    return { token: sign(acc.id), email: em, recoveryCode: nextCode };
});

// Generate/rotate a recovery code for the signed-in account — lets accounts created before this
// feature obtain one, and lets anyone replace a used or lost code.
app.post('/auth/recovery', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const code = makeRecoveryCode();
    const hash = await hashPassword(normCode(code));
    store.setAccountAuth(req.accountId, { recovery_hash: hash, updated_at: Date.now() });
    return { recoveryCode: code };
});

// Sliding session: a client with a still-valid token swaps it for a fresh one on each app open, so
// an actively-used "remember me" session never expires. An expired token 401s here -> client re-logs-in.
app.post('/auth/refresh', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    return { token: sign(req.accountId) };
});

// ---- Live connections (for the Server tray's "Current Connections") ----
// Every authed request refreshes a per-device liveness record; the Player also heartbeats (~60s) while
// it's open. /connections and /connections.json are LOCALHOST-ONLY (served only to the tray on this
// same box) so connected users' IPs never leak to remote clients.
const CONN_TTL_MS = 150000; // a device drops off ~2.5 min after its last beat (heartbeat is ~60s)
const liveConns = new Map(); // `${accountId}|${ip}` -> { accountId, ip, lastSeen }
function recordConn(accountId, ip, ua) {
    if (!accountId || !ip) return;
    liveConns.set(accountId + '|' + ip, { accountId, ip, ua, lastSeen: Date.now() });
}
function parseDevice(ua) {
    if (!ua) return 'Unknown';
    let os = 'Unknown';
    if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/iPhone/i.test(ua)) os = 'iPhone';
    else if (/iPad/i.test(ua)) os = 'iPad';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/CrOS/i.test(ua)) os = 'ChromeOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    if (/Electron|Umbry/i.test(ua)) return 'Umbry Desktop \u00b7 ' + os;
    let br = 'Browser';
    if (/Edg\//i.test(ua)) br = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) br = 'Opera';
    else if (/SamsungBrowser/i.test(ua)) br = 'Samsung Internet';
    else if (/Firefox\//i.test(ua)) br = 'Firefox';
    else if (/Chrome\//i.test(ua)) br = 'Chrome';
    else if (/Safari\//i.test(ua)) br = 'Safari';
    return br + ' on ' + os;
}
function activeConns() {
    const cut = Date.now() - CONN_TTL_MS;
    const out = [];
    for (const [k, v] of liveConns) { if (v.lastSeen < cut) liveConns.delete(k); else out.push(v); }
    return out;
}
function isLoopback(req) {
    const a = (req.socket && req.socket.remoteAddress) || ''; // raw TCP peer, NOT the XFF-derived req.ip
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function isPrivateIp(ip) {
    const c = ip.replace(/^::ffff:/, '');
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd|fe80)/i.test(c);
}
const geoCache = new Map(); // ip -> { loc, at }
async function geoLocate(ip) {
    const clean = ip.replace(/^::ffff:/, '');
    if (clean === '127.0.0.1' || clean === '::1') return 'This machine';
    if (isPrivateIp(clean)) return 'Local network';
    const hit = geoCache.get(clean);
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.loc;
    let loc = 'Unknown';
    try {
        const r = await fetch(`http://ip-api.com/json/${clean}?fields=status,city,regionName,country`, { signal: AbortSignal.timeout(4000) });
        const d = await r.json();
        if (d && d.status === 'success') loc = [d.city, d.regionName, d.country].filter(Boolean).join(', ') || 'Unknown';
    } catch { /* offline / rate-limited -> Unknown */ }
    geoCache.set(clean, { loc, at: Date.now() });
    return loc;
}

// Player heartbeat — keeps the account marked "connected" while the Player is open.
app.post('/heartbeat', { preHandler: requireAuth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    recordConn(req.accountId, req.ip, req.headers['user-agent']);
    return { ok: true };
});

// Live connections as JSON — LOCALHOST-ONLY (the tray polls this).
app.get('/connections.json', async (req, reply) => {
    if (!isLoopback(req)) return reply.code(403).send({ error: 'local only' });
    const rows = await Promise.all(activeConns().map(async (c) => {
        const acc = store.data.accounts[c.accountId];
        return {
            email: (acc && acc.email) || 'unknown',
            device: parseDevice(c.ua),
            ip: c.ip.replace(/^::ffff:/, ''),
            location: await geoLocate(c.ip),
            secondsAgo: Math.round((Date.now() - c.lastSeen) / 1000)
        };
    }));
    rows.sort((a, b) => a.secondsAgo - b.secondsAgo);
    reply.header('Cache-Control', 'no-store');
    return { count: rows.length, connections: rows, generatedAt: Date.now() };
});

// The frosted-glass "Current Connections" window — LOCALHOST-ONLY.
const CONNECTIONS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Current Connections — Umbry</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;font:14px -apple-system,Segoe UI,Roboto,system-ui,sans-serif;color:#e7e3f0;background:#0e0c15;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.aurora{position:fixed;inset:0;overflow:hidden;z-index:0}
.blob{position:absolute;border-radius:50%;filter:blur(80px);opacity:.45}
.b1{width:340px;height:340px;background:#FF9A4B;top:-90px;left:-70px}
.b2{width:300px;height:300px;background:#9385F5;bottom:-80px;right:-50px}
.b3{width:240px;height:240px;background:#C77BD8;top:45%;left:55%}
.card{position:relative;z-index:1;width:min(94vw,640px);max-height:90vh;overflow:auto;background:rgba(20,18,40,.55);backdrop-filter:blur(22px) saturate(1.35);-webkit-backdrop-filter:blur(22px) saturate(1.35);border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:22px 24px}
.hd{display:flex;align-items:center;gap:10px}
.dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 9px #4ade80;flex:0 0 auto}
h1{font-size:18px;margin:0;font-weight:700;background:linear-gradient(100deg,#FFC670,#FF9A4B,#C77BD8,#9385F5);-webkit-background-clip:text;background-clip:text;color:transparent}
.count{color:#b9b6c6;font-size:12.5px;margin:3px 0 16px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a86a0;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.1)}
td{padding:11px 10px;border-bottom:1px solid rgba(255,255,255,.06)}
tr:last-child td{border-bottom:0}
.acct{font-weight:600}
.ip{font-variant-numeric:tabular-nums;color:#c7c3d6}\n.dev{color:#d9d5e8}
.ago{color:#8a86a0;font-size:12.5px;white-space:nowrap}
.empty{text-align:center;color:#8a86a0;padding:28px}
.foot{margin-top:14px;font-size:11px;color:#6b6880;text-align:center}
</style></head><body>
<div class="aurora"><span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span></div>
<div class="card">
  <div class="hd"><span class="dot"></span><h1>Current Connections</h1></div>
  <div class="count" id="count">Checking…</div>
  <table><thead><tr><th>Account</th><th>Device</th><th>IP address</th><th>Location</th><th>Last seen</th></tr></thead><tbody id="rows"></tbody></table>
  <div class="foot">Devices with the Umbry Player open and connected to this server · refreshes automatically</div>
</div>
<script>
function esc(s){return String(s).replace(/[&<>"]/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]);});}
function ago(s){return s<5?'just now':(s<60?s+'s ago':Math.round(s/60)+'m ago');}
async function load(){
  try{
    var r=await fetch('/connections.json',{cache:'no-store'}); var d=await r.json();
    document.getElementById('count').textContent=d.count+(d.count===1?' device':' devices')+' connected right now';
    var t=document.getElementById('rows');
    if(!d.connections.length){t.innerHTML='<tr><td class="empty" colspan="5">No one is connected right now.</td></tr>';return;}
    t.innerHTML=d.connections.map(function(c){return '<tr><td class="acct">'+esc(c.email)+'</td><td class="dev">'+esc(c.device||'')+'</td><td class="ip">'+esc(c.ip)+'</td><td>'+esc(c.location)+'</td><td class="ago">'+ago(c.secondsAgo)+'</td></tr>';}).join('');
  }catch(e){document.getElementById('count').textContent='Could not reach the server.';}
}
load();setInterval(load,4000);
</script></body></html>`;

app.get('/connections', async (req, reply) => {
    if (!isLoopback(req)) { reply.code(403); return reply.type('text/plain').send('local only'); }
    reply.type('text/html');
    return CONNECTIONS_HTML;
});


app.get('/settings', { preHandler: requireAuth }, async (req) => {
    const row = store.getSettings(req.accountId);
    if (!row) return { blob: {}, version: 0 };
    let obj = {};
    try { obj = JSON.parse(decrypt(row.blob)); } catch { /* corrupt/blank -> empty */ }
    return { blob: obj, version: row.version };
});

app.put('/settings', { preHandler: requireAuth }, async (req, reply) => {
    const { blob, version } = req.body || {};
    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
        return reply.code(400).send({ error: 'blob object required' });
    }
    const row = store.getSettings(req.accountId);
    const cur = row ? row.version : 0;
    // Optimistic concurrency: on mismatch, hand back the current server copy so the client merges + retries.
    if (typeof version === 'number' && version !== cur) {
        let obj = {};
        try { obj = row ? JSON.parse(decrypt(row.blob)) : {}; } catch { /* empty */ }
        return reply.code(409).send({ error: 'version conflict', blob: obj, version: cur });
    }
    const next = cur + 1;
    store.upsertSettings(req.accountId, encrypt(JSON.stringify(blob)), next, Date.now());
    return { version: next };
});

app.listen({ port: PORT, host: HOST })
    .then(() => app.log.info(`umbry-server listening on ${HOST}:${PORT}`))
    .catch((err) => { app.log.error(err); process.exit(1); });
