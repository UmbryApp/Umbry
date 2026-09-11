/* eslint-disable @typescript-eslint/no-explicit-any */
// Umbry — Simkl integration. The free scrobbling provider (Trakt made API apps VIP-only in 2026-07;
// Simkl app registration is free for apps under $150/mo revenue — Umbry qualifies). Links via the PIN
// device-code flow (type a short code at simkl.com/pin — works phone/desktop/TV) and marks items
// watched on Simkl when you finish them, plus watchlist + ratings sync. Matched by IMDb/TMDb/TVDb id.
//
// SIMKL API RULES (from the Developer console — obey or the client_id gets suspended):
//  - EVERY request must carry client_id + app-name + app-version URL params (added by qurl()).
//  - POST is limited to 1 request/second/client — all POSTs go through a serialized 1/sec throttle.
//  - NEVER run unconditional background polling. Umbry only pushes on user actions / playback-stop —
//    there is deliberately NO timer/poll here. If we ever PULL Simkl lists, follow the /sync/activities
//    + /sync/all-items?date_from= flow (Phase 1/2) — not implemented yet.
//  The Client ID is public by design (embedded in the client). The Client SECRET is NOT needed for the
//  PIN flow, so it is intentionally not stored here (keeps the public GPL repo clean).
import Events from 'utils/events';

const DEFAULT_BASE = 'https://api.simkl.com';
const CLIENT_ID = '0a56827712d4a3f4df3301352232ce0fa5580a5cd7146b0f1c9a22d57fe1d9c4';   // Umbry's Simkl app
const APP_NAME = 'Umbry';
const APP_VERSION = '1.0';

interface Cfg { id: string; base: string }
function cfg(): Cfg {
    let id = CLIENT_ID; let base = DEFAULT_BASE;
    try { const c = JSON.parse(localStorage.getItem('jpx-simkl-client') || '{}'); if (c.id) id = c.id; } catch { /* ignore */ }
    try { const b = localStorage.getItem('jpx-simkl-base'); if (b) base = b.replace(/\/$/, ''); } catch { /* ignore */ }
    return { id, base };
}
export function isConfigured(): boolean { return !!cfg().id; }

const TOKEN_KEY = 'jpx-simkl-token';
const SCROBBLE_PREF = 'jpx-simkl-scrobble';
function getToken(): string { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function saveToken(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
export function isLinked(): boolean { return !!getToken(); }
export function unlink(): void { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
export function scrobbleEnabled(): boolean { try { return localStorage.getItem(SCROBBLE_PREF) !== '0'; } catch { return true; } }
export function setScrobbleEnabled(on: boolean): void { try { localStorage.setItem(SCROBBLE_PREF, on ? '1' : '0'); } catch { /* ignore */ } }

// Every Simkl request must carry client_id + app-name + app-version (Developer-console rule).
function qurl(path: string, extra?: Record<string, string>): string {
    const c = cfg();
    const p = new URLSearchParams({ client_id: c.id, 'app-name': APP_NAME, 'app-version': APP_VERSION, ...(extra || {}) });
    return c.base + path + '?' + p.toString();
}
// (User-Agent is required too, but browsers forbid setting it from fetch — the WebView UA is sent
//  automatically; app identity is carried by the app-name/app-version params above.)
function headers(auth = true): Record<string, string> {
    const c = cfg();
    const h: Record<string, string> = { 'Content-Type': 'application/json', 'simkl-api-key': c.id };
    if (auth) { const t = getToken(); if (t) h['Authorization'] = 'Bearer ' + t; }
    return h;
}

// Serialize POSTs to <=1/sec/client (Simkl rate limit). Returns the Response.
let lastPost = 0;
let chain: Promise<any> = Promise.resolve();
function throttledFetch(path: string, body: any, params?: Record<string, string>): Promise<Response> {
    const p = chain.then(async () => {
        const wait = Math.max(0, 1100 - (Date.now() - lastPost));
        if (wait) await new Promise(r => setTimeout(r, wait));
        lastPost = Date.now();
        return fetch(qurl(path, params), { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
    });
    chain = p.then(() => undefined, () => undefined);
    return p;
}
async function post(path: string, body: any): Promise<boolean> {
    try { const r = await throttledFetch(path, body); return r.ok; } catch { return false; }
}

// ---- PIN (device-code) auth ----
export interface DeviceCode { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }
export async function startDeviceAuth(): Promise<DeviceCode> {
    const c = cfg();
    const r = await fetch(qurl('/oauth/pin'), { headers: { 'simkl-api-key': c.id } });
    if (!r.ok) throw new Error('Simkl PIN request failed (' + r.status + ')');
    const j = await r.json();
    if (j.result !== 'OK') throw new Error('Simkl PIN request failed');
    return { device_code: j.device_code, user_code: j.user_code, verification_url: j.verification_url || 'https://simkl.com/pin/', expires_in: j.expires_in || 900, interval: j.interval || 5 };
}
export type PollResult = 'pending' | 'done' | 'expired' | 'denied';
// Simkl polls by the user_code.
export async function pollDeviceToken(userCode: string): Promise<PollResult> {
    const c = cfg();
    try {
        const r = await fetch(qurl('/oauth/pin/' + encodeURIComponent(userCode)), { headers: { 'simkl-api-key': c.id } });
        if (!r.ok) return 'pending';
        const j = await r.json();
        if (j.result === 'OK' && j.access_token) { saveToken(j.access_token); return 'done'; }
        return 'pending';
    } catch { return 'pending'; }
}

export async function getMe(): Promise<{ username?: string } | null> {
    if (!isLinked()) return null;
    try { const r = await throttledFetch('/users/settings', {}); if (!r.ok) return null; const j = await r.json(); return { username: (j.user && (j.user.name || j.user.username)) || undefined }; } catch { return null; }
}

// ---- mark watched (Simkl's "scrobble") ----
function nowIso(): string { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
function idsOf(p: any): any { const ids: any = {}; if (p) { if (p.Imdb) ids.imdb = p.Imdb; if (p.Tmdb) ids.tmdb = String(p.Tmdb); if (p.Tvdb) ids.tvdb = String(p.Tvdb); } return ids; }
function watchedBody(item: any): any | null {
    const ids = idsOf(item && item.ProviderIds);
    if (item && item.Type === 'Movie') { if (!Object.keys(ids).length) return null; return { movies: [{ watched_at: nowIso(), ids }] }; }
    if (item && item.Type === 'Episode') {
        const sids = idsOf(item.SeriesProviderIds);
        if (Object.keys(sids).length && item.ParentIndexNumber != null && item.IndexNumber != null) {
            return { shows: [{ ids: sids, seasons: [{ number: item.ParentIndexNumber, episodes: [{ number: item.IndexNumber, watched_at: nowIso() }] }] }] };
        }
    }
    return null;
}
export async function markWatched(item: any): Promise<boolean> {
    if (!isConfigured() || !isLinked() || !scrobbleEnabled()) return false;
    const body = watchedBody(item);
    if (!body) return false;
    return post('/sync/history', body);
}

// ---- wiring: mark watched on playback-stop past ~80% (event-driven; NO polling) ----
let wired = false;
export function initJpxSimkl(): void {
    if (wired) return; wired = true;
    let last: any = null; let lastPct = 0; let ticker: any = null;
    import('components/playback/playbackmanager').then((mod: any) => {
        const pm = mod.playbackManager || mod.default;
        if (!pm) return;
        const pct = (player: any): number => { try { const c = pm.getCurrentTicks(player); const d = pm.duration(player); return d ? c / d * 100 : 0; } catch { return 0; } };
        const item = (player: any): any => { try { return pm.currentItem(player); } catch { return null; } };
        Events.on(pm, 'playbackstart', (_e: any, player: any) => {
            last = item(player); lastPct = pct(player);
            if (ticker) clearInterval(ticker);
            ticker = setInterval(() => { try { lastPct = pct(player); } catch { /* ignore */ } }, 10000);
        });
        Events.on(pm, 'playbackstop', (_e: any, info: any) => {
            if (ticker) { clearInterval(ticker); ticker = null; }
            let it = last; let p = lastPct;
            try { if (info && info.item) { it = info.item; if (info.item.RunTimeTicks && info.positionTicks != null) p = info.positionTicks / info.item.RunTimeTicks * 100; } } catch { /* ignore */ }
            if (it && p >= 80) markWatched(it);
            last = null; lastPct = 0;
        });
    }).catch(() => { /* playbackmanager not present */ });
}

// ---- watchlist + ratings sync ----
function ok(): boolean { return isConfigured() && isLinked(); }
// Build a movies/shows body; `extra` fields (e.g. rating) attach to the movie/show/episode leaf.
function listBody(item: any, extra: any): any | null {
    if (!item) return null;
    const ids = idsOf(item.ProviderIds);
    if (item.Type === 'Movie') { if (!Object.keys(ids).length) return null; return { movies: [{ ...extra, ids }] }; }
    if (item.Type === 'Series') { if (!Object.keys(ids).length) return null; return { shows: [{ ...extra, ids }] }; }
    if (item.Type === 'Episode') {
        const sids = idsOf(item.SeriesProviderIds);
        if (Object.keys(sids).length && item.ParentIndexNumber != null && item.IndexNumber != null) {
            return { shows: [{ ids: sids, seasons: [{ number: item.ParentIndexNumber, episodes: [{ number: item.IndexNumber, ...extra }] }] }] };
        }
    }
    return null;
}
export async function addToWatchlist(item: any): Promise<boolean> { if (!ok()) return false; const b = listBody(item, {}); if (!b) return false; b.to = 'plantowatch'; return post('/sync/add-to-list', b); }
export async function removeFromWatchlist(item: any): Promise<boolean> { if (!ok()) return false; const b = listBody(item, {}); if (!b) return false; return post('/sync/history/remove', b); }
export async function rate(item: any, rating: number): Promise<boolean> { if (!ok()) return false; const b = listBody(item, { rating: Math.max(1, Math.min(10, Math.round(rating))) }); if (!b) return false; return post('/sync/ratings', b); }
export async function unrate(item: any): Promise<boolean> { if (!ok()) return false; const b = listBody(item, {}); if (!b) return false; return post('/sync/ratings/remove', b); }

try { (window as any).jpxSimkl = { isConfigured, isLinked, unlink, startDeviceAuth, pollDeviceToken, getMe, markWatched, scrobbleEnabled, setScrobbleEnabled, addToWatchlist, removeFromWatchlist, rate, unrate }; } catch { /* ignore */ }
