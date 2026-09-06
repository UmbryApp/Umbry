// Umbry account client — talks to the Umbry backend (its OWN settings/account service,
// NOT any media server). A Umbry account (email + password) is the identity that owns the user's
// server list + all app settings, so they persist server-side and sync across devices.
//
// API base: the dev app is served over http on the LAN, so it talks to the LAN backend directly
// (no mixed-content). A production app served over https MUST use the public https API (an https
// page cannot call an http backend). Override with localStorage['jpx-api-base'] if ever needed.

const TOKEN_KEY = 'jpx-account-token';
const EMAIL_KEY = 'jpx-account-email';

export function apiBase(): string {
    try {
        const override = localStorage.getItem('jpx-api-base');
        if (override) return override.replace(/\/+$/, '');
    } catch { /* ignore */ }
    // The account/settings SYNC backend (OPTIONAL — the Player works as a plain client without it).
    // A first-party build may pin one via window.__UMBRY_API_BASE; otherwise default to THIS host's
    // own Umbry Server, so a self-hoster reaches their OWN server and never a third party's.
    try {
        const cfg = (window as unknown as { __UMBRY_API_BASE?: string }).__UMBRY_API_BASE;
        if (cfg) return String(cfg).replace(/\/+$/, '');
        return `${window.location.protocol}//${window.location.hostname}:8790`;
    } catch {
        return '';
    }
}

export function accountToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function accountEmail(): string | null {
    try { return localStorage.getItem(EMAIL_KEY); } catch { return null; }
}
function setSession(token: string, email: string): void {
    try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(EMAIL_KEY, email); } catch { /* ignore */ }
}
export function logoutAccount(): void {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
}

// recoveryCode is returned by register + reset (a one-time code the user saves to reset later).
interface AuthResult { ok: boolean; error?: string; recoveryCode?: string }

async function auth(path: string, email: string, password: string): Promise<AuthResult> {
    try {
        const res = await fetch(`${apiBase()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data?.error || `Error ${res.status}` };
        if (!data?.token) return { ok: false, error: 'No token returned' };
        setSession(data.token, data.email || email);
        return { ok: true, recoveryCode: data.recoveryCode };
    } catch (e) {
        return { ok: false, error: 'Could not reach the Umbry server. Check your connection.' };
    }
}

export function loginAccount(email: string, password: string): Promise<AuthResult> {
    return auth('/auth/login', email, password);
}
export function registerAccount(email: string, password: string): Promise<AuthResult> {
    return auth('/auth/register', email, password);
}

/**
 * Reset the account password using the recovery code shown at signup. On success the user is signed
 * in and a FRESH recovery code is returned (the used one stops working) — surface it for them to save.
 */
export async function resetPassword(email: string, recoveryCode: string, newPassword: string): Promise<AuthResult> {
    try {
        const res = await fetch(`${apiBase()}/auth/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, recoveryCode, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data?.error || `Error ${res.status}` };
        if (!data?.token) return { ok: false, error: 'No token returned' };
        setSession(data.token, data.email || email);
        return { ok: true, recoveryCode: data.recoveryCode };
    } catch (e) {
        return { ok: false, error: 'Could not reach the Umbry server. Check your connection.' };
    }
}

/**
 * Generate (rotate) a recovery code for the signed-in account — from Settings, so users whose
 * account predates the feature can obtain one, or replace a used/lost code. Returns the new code.
 */
export async function generateRecoveryCode(): Promise<AuthResult> {
    const token = accountToken();
    if (!token) return { ok: false, error: 'Sign in to your Umbry account first.' };
    try {
        const res = await fetch(`${apiBase()}/auth/recovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: '{}' // Fastify's JSON parser 400s on an empty body when content-type is application/json
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const where = ` — ${apiBase()}`;
            if (res.status === 404) return { ok: false, error: `This Umbry Server doesn’t support recovery codes yet — update your Umbry Server.${where}` };
            return { ok: false, error: (data?.error || `Error ${res.status}`) + where };
        }
        return { ok: true, recoveryCode: data.recoveryCode };
    } catch (e) {
        return { ok: false, error: 'Could not reach the Umbry server. Check your connection.' };
    }
}

// ---- Umbry Server selection + sync mode (Server/Player split) ----
// A Umbry Server (email/password account + settings store) runs on the user's own always-on box.
// The Player connects to it by URL. Users who don't want cross-device sync can run local-only.
const SYNC_MODE_KEY = 'jpx-sync-mode';
const API_BASE_KEY = 'jpx-api-base';

export type SyncMode = 'server' | 'local';

export function getSyncMode(): SyncMode | null {
    try { const v = localStorage.getItem(SYNC_MODE_KEY); return (v === 'server' || v === 'local') ? v : null; } catch { return null; }
}
export function setSyncMode(m: SyncMode): void { try { localStorage.setItem(SYNC_MODE_KEY, m); } catch { /* ignore */ } }
export function getServerUrl(): string { try { return localStorage.getItem(API_BASE_KEY) || ''; } catch { return ''; } }

function normalizeUrl(url: string): string {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u;
}
export function setServerUrl(url: string): void {
    const u = normalizeUrl(url);
    try { if (u) localStorage.setItem(API_BASE_KEY, u); } catch { /* ignore */ }
}
/** Validate that `url` is reachable and is a Umbry Server (its /health endpoint answers). */
export async function probeServer(url: string): Promise<{ ok: boolean; error?: string }> {
    const u = normalizeUrl(url);
    if (!u) return { ok: false, error: 'Enter your Umbry Server address' };
    try {
        const res = await fetch(u + '/health', { method: 'GET' });
        if (res.ok) return { ok: true };
        return { ok: false, error: 'That address answered but isn\u2019t a Umbry Server (' + res.status + ')' };
    } catch { return { ok: false, error: 'Could not reach that server \u2014 check the address' }; }
}

/**
 * Auto-detect an Umbry Server reachable from this device — primarily the same-machine case (the
 * Player installed on the same box as the Server, where localhost:8790 answers), and the LAN host
 * the app is served from. Returns a bare host:port to pre-fill on first run, or '' if none found.
 */
export async function detectLocalServer(): Promise<string> {
    const PORT = 8790;
    const probe = (host: string): Promise<string> => new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, 1500);
        fetch('http://' + host + ':' + PORT + '/health', { method: 'GET', signal: ctrl.signal })
            .then(r => { clearTimeout(t); if (r.ok) { resolve(host + ':' + PORT); } else { reject(new Error('not-umbry')); } })
            .catch(err => { clearTimeout(t); reject(err); });
    });
    // Prefer the LAN host the app is served from (portable to other devices), then localhost.
    let hostCand = '';
    try {
        const h = window.location.hostname;
        if (h && h !== 'localhost' && h !== '127.0.0.1' && /^[0-9a-z.-]+$/i.test(h)) hostCand = h;
    } catch { /* ignore */ }
    if (hostCand) { try { return await probe(hostCand); } catch { /* fall through to loopback */ } }
    try { return await probe('localhost'); } catch { /* try loopback IP next */ }
    try { return await probe('127.0.0.1'); } catch { /* none found */ }
    return '';
}


// ============================================================================================
// Remember-me / avatar profiles + sliding-refresh + multi-server discovery (added 2026-09-04).
// ============================================================================================

// ---- Session refresh (sliding permanence) ----
export type RefreshResult = 'ok' | 'unsupported' | 'expired' | 'offline';
/**
 * Swap a still-valid token for a fresh one so an actively-used "remember me" session never expires.
 * 'unsupported' = the server predates /auth/refresh (the existing token still works until it expires);
 * 'expired' = the token is no longer valid (caller should fall back to a password sign-in).
 */
export async function refreshSession(): Promise<RefreshResult> {
    const token = accountToken();
    if (!token) return 'expired';
    try {
        const res = await fetch(`${apiBase()}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: '{}'
        });
        if (res.status === 404) return 'unsupported';
        if (res.status === 401) return 'expired';
        if (!res.ok) return 'offline';
        const data = await res.json().catch(() => ({}));
        if (data && data.token) setSession(data.token, accountEmail() || '');
        return 'ok';
    } catch { return 'offline'; }
}

// ---- Known servers (for the sign-in server dropdown) ----
const SERVERS_KEY = 'jpx-known-servers';
export function getKnownServers(): string[] {
    try { const v = JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function saveKnownServers(list: string[]): void { try { localStorage.setItem(SERVERS_KEY, JSON.stringify([...new Set(list)])); } catch { /* ignore */ } }
export function addKnownServer(url: string): void {
    const u = normalizeUrl(url); if (!u) return;
    const list = getKnownServers(); if (!list.includes(u)) { list.push(u); saveKnownServers(list); }
}
export function removeKnownServer(url: string): void {
    const u = normalizeUrl(url); saveKnownServers(getKnownServers().filter(x => x !== u));
}

/**
 * Discover every reachable Umbry Server on the network. The Electron Player's main process sweeps the
 * real LAN (exposed as window.umbry.detectServers); a web/docker build served from a LAN IP probes its
 * own /24; loopback + already-known servers are always included. De-duped, normalized URLs.
 */
export async function detectAllServers(): Promise<string[]> {
    const found = new Set<string>();
    getKnownServers().forEach(s => found.add(s));
    const cur = normalizeUrl(getServerUrl()); if (cur) found.add(cur);
    const umbry = (window as unknown as { umbry?: { detectServers?: () => Promise<string[]> } }).umbry;
    if (umbry && umbry.detectServers) {
        try { (await umbry.detectServers() || []).forEach(h => { const u = normalizeUrl(h); if (u) found.add(u); }); } catch { /* ignore */ }
    }
    try {
        const h = window.location.hostname;
        const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
        if (m && h !== '127.0.0.1') {
            (await sweepSubnet(`${m[1]}.${m[2]}.${m[3]}.`, 8790)).forEach(u => found.add(u));
        }
    } catch { /* ignore */ }
    try { const one = await detectLocalServer(); if (one) found.add(normalizeUrl(one)); } catch { /* ignore */ }
    return [...found];
}

async function sweepSubnet(base: string, port: number): Promise<string[]> {
    const hits: string[] = [];
    const probe = (ip: string) => new Promise<void>((resolve) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => { ctrl.abort(); resolve(); }, 1200);
        fetch(`http://${ip}:${port}/health`, { signal: ctrl.signal })
            .then(r => { clearTimeout(t); if (r.ok) hits.push(`http://${ip}:${port}`); resolve(); })
            .catch(() => { clearTimeout(t); resolve(); });
    });
    const ips: string[] = []; for (let i = 1; i <= 254; i++) ips.push(base + i);
    let idx = 0;
    await Promise.all(Array.from({ length: 32 }, async () => { while (idx < ips.length) { await probe(ips[idx++]); } }));
    return hits;
}

// ---- Remembered profiles (avatar sign-in) ----
// A Profile stores the session token (NOT the password) for one account on one server, so a returning
// user clicks their avatar instead of re-typing credentials. Avatar = 'preset:<id>' or 'upload:<data-uri>'.
export interface Profile { id: string; email: string; avatar: string; serverUrl: string; token: string; }
const PROFILES_KEY = 'jpx-profiles';
export function getProfiles(): Profile[] {
    try { const v = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeProfiles(list: Profile[]): void { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch { /* ignore */ } }
export function getProfilesFor(serverUrl: string): Profile[] {
    const u = normalizeUrl(serverUrl); return getProfiles().filter(p => p.serverUrl === u);
}
/** Remember the CURRENT session (active server + token + email) as a profile. Call after a successful login. */
export function saveProfile(email: string, avatar: string): void {
    const serverUrl = normalizeUrl(getServerUrl());
    const token = accountToken() || '';
    if (!serverUrl || !token || !email) return;
    const list = getProfiles();
    const existing = list.find(p => p.serverUrl === serverUrl && p.email.toLowerCase() === email.toLowerCase());
    if (existing) { if (avatar) existing.avatar = avatar; existing.token = token; existing.email = email; }
    else list.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, email, avatar: avatar || 'preset:eclipse', serverUrl, token });
    writeProfiles(list);
}
export function removeProfile(id: string): void { writeProfiles(getProfiles().filter(p => p.id !== id)); }
function updateProfileToken(id: string, token: string): void {
    const list = getProfiles(); const p = list.find(x => x.id === id); if (p && token) { p.token = token; writeProfiles(list); }
}
/** Sign in as a saved profile: adopt its server + token, then slide-refresh. Returns session liveness. */
export async function useProfile(p: Profile): Promise<RefreshResult> {
    setServerUrl(p.serverUrl); setSyncMode('server'); setSession(p.token, p.email);
    const r = await refreshSession();
    if (r === 'ok') updateProfileToken(p.id, accountToken() || p.token);
    return r;
}

// ---- Live-connection heartbeat (feeds the Server tray's "Current Connections") ----
let _hbStarted = false;
export function startHeartbeat(): void {
    if (_hbStarted) return;
    _hbStarted = true;
    const beat = () => {
        const token = accountToken();
        if (!token || getSyncMode() !== 'server') return;
        fetch(`${apiBase()}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: '{}'
        }).catch(() => { /* offline / older server without /heartbeat — ignore */ });
    };
    beat();
    setInterval(beat, 60000);
}
