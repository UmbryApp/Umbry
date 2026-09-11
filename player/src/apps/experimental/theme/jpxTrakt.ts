/* eslint-disable @typescript-eslint/no-explicit-any */
// Umbry — Trakt.tv integration. Links a Trakt account with the OAuth *device code* flow (no embedded
// browser: the user types a short code at trakt.tv/activate — works on phone, desktop AND TV), then
// scrobbles playback (start / pause / stop) so what you watch in Umbry updates your Trakt history and
// progress. Items map to Trakt by their IMDb / TMDb / TVDb ids (Jellyfin/Emby ProviderIds).
//
// The Trakt app key (client id + secret) is a build constant, overridable via localStorage for
// testing. Register a free app at trakt.tv/oauth/applications under the Umbry identity and drop the
// keys into CLIENT_ID / CLIENT_SECRET (or the jpx-trakt-client override) to go live.
import Events from 'utils/events';

const DEFAULT_BASE = 'https://api.trakt.tv';
const CLIENT_ID = '';       // <-- set to the Umbry Trakt app client_id to enable in the shipped build
const CLIENT_SECRET = '';   // <-- set to the Umbry Trakt app client_secret

const TOKEN_KEY = 'jpx-trakt-token';
const SCROBBLE_PREF = 'jpx-trakt-scrobble';   // '0' disables scrobbling while still linked

interface TraktCfg { id: string; secret: string; base: string }
function cfg(): TraktCfg {
    let id = CLIENT_ID; let secret = CLIENT_SECRET; let base = DEFAULT_BASE;
    try { const c = JSON.parse(localStorage.getItem('jpx-trakt-client') || '{}'); if (c.id) id = c.id; if (c.secret) secret = c.secret; } catch { /* ignore */ }
    try { const b = localStorage.getItem('jpx-trakt-base'); if (b) base = b.replace(/\/$/, ''); } catch { /* ignore */ }
    return { id, secret, base };
}

export function isConfigured(): boolean { return !!cfg().id; }

interface TraktToken { access_token: string; refresh_token: string; expires_at: number }
function getToken(): TraktToken | null { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); return (t && t.access_token) ? t : null; } catch { return null; } }
function saveToken(raw: any) {
    const t: TraktToken = { access_token: raw.access_token, refresh_token: raw.refresh_token, expires_at: Date.now() + (Number(raw.expires_in || 7776000) * 1000) };
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}
export function isLinked(): boolean { return !!getToken(); }
export function unlink(): void { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
export function scrobbleEnabled(): boolean { try { return localStorage.getItem(SCROBBLE_PREF) !== '0'; } catch { return true; } }
export function setScrobbleEnabled(on: boolean): void { try { localStorage.setItem(SCROBBLE_PREF, on ? '1' : '0'); } catch { /* ignore */ } }

function apiHeaders(auth = true): Record<string, string> {
    const c = cfg();
    const h: Record<string, string> = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': c.id };
    if (auth) { const t = getToken(); if (t) h['Authorization'] = 'Bearer ' + t.access_token; }
    return h;
}

// ---- OAuth device-code flow ----
export interface DeviceCode { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }
export async function startDeviceAuth(): Promise<DeviceCode> {
    const c = cfg();
    const r = await fetch(c.base + '/oauth/device/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: c.id }) });
    if (!r.ok) throw new Error('Trakt device code request failed (' + r.status + ')');
    return r.json();
}
export type PollResult = 'pending' | 'done' | 'expired' | 'denied' | 'slow_down';
export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
    const c = cfg();
    const r = await fetch(c.base + '/oauth/device/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: deviceCode, client_id: c.id, client_secret: c.secret }) });
    if (r.status === 200) { saveToken(await r.json()); return 'done'; }
    if (r.status === 400) return 'pending';   // authorization pending
    if (r.status === 429) return 'slow_down';
    if (r.status === 418) return 'denied';    // user denied
    if (r.status === 410 || r.status === 404) return 'expired';
    if (r.status === 409) return 'done';      // already approved
    return 'pending';
}

async function refreshIfNeeded(): Promise<void> {
    const t = getToken(); const c = cfg();
    if (!t || !t.refresh_token) return;
    if (t.expires_at > Date.now() + 60000) return;
    try {
        const r = await fetch(c.base + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: t.refresh_token, client_id: c.id, client_secret: c.secret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' }) });
        if (r.ok) saveToken(await r.json());
    } catch { /* ignore */ }
}

// ---- account (for the link screen "connected as …") ----
export async function getMe(): Promise<{ username?: string; name?: string } | null> {
    if (!isLinked()) return null;
    try { await refreshIfNeeded(); const r = await fetch(cfg().base + '/users/me', { headers: apiHeaders() }); if (!r.ok) return null; const u = await r.json(); return { username: u.username, name: u.name }; } catch { return null; }
}

// ---- scrobble ----
// Map an Umbry item to a Trakt scrobble body. Movies + episodes with a known external id.
function traktBody(item: any): any | null {
    const p = item && item.ProviderIds ? item.ProviderIds : {};
    const ids: any = {};
    if (p.Imdb) ids.imdb = p.Imdb;
    if (p.Tmdb) ids.tmdb = Number(p.Tmdb);
    if (p.Tvdb) ids.tvdb = Number(p.Tvdb);
    const type = item && item.Type;
    if (type === 'Movie') { if (!Object.keys(ids).length) return null; return { movie: { ids } }; }
    if (type === 'Episode') {
        if (Object.keys(ids).length) return { episode: { ids } };
        // fall back to show ids + season/number when the episode itself has no external id
        const sp = item.SeriesProviderIds || {};
        const sids: any = {}; if (sp.Imdb) sids.imdb = sp.Imdb; if (sp.Tmdb) sids.tmdb = Number(sp.Tmdb); if (sp.Tvdb) sids.tvdb = Number(sp.Tvdb);
        if (Object.keys(sids).length && item.ParentIndexNumber != null && item.IndexNumber != null) {
            return { show: { ids: sids }, episode: { season: item.ParentIndexNumber, number: item.IndexNumber } };
        }
    }
    return null;
}

export async function scrobble(action: 'start' | 'pause' | 'stop', item: any, progressPct: number): Promise<void> {
    if (!isConfigured() || !isLinked() || !scrobbleEnabled()) return;
    const body = traktBody(item);
    if (!body) return;
    body.progress = Math.max(0, Math.min(100, Math.round(progressPct * 100) / 100));
    try { await refreshIfNeeded(); await fetch(cfg().base + '/scrobble/' + action, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) }); } catch { /* ignore */ }
}

// ---- watchlist + ratings sync ----
function traktIds(p: any): any { const ids: any = {}; if (p) { if (p.Imdb) ids.imdb = p.Imdb; if (p.Tmdb) ids.tmdb = Number(p.Tmdb); if (p.Tvdb) ids.tvdb = Number(p.Tvdb); } return ids; }
// Movies/shows/episodes body; `extra` (e.g. rating) attaches to the leaf.
function traktSyncBody(item: any, extra: any): any | null {
    if (!item) return null;
    const ids = traktIds(item.ProviderIds);
    if (item.Type === 'Movie') { if (!Object.keys(ids).length) return null; return { movies: [{ ...extra, ids }] }; }
    if (item.Type === 'Series') { if (!Object.keys(ids).length) return null; return { shows: [{ ...extra, ids }] }; }
    if (item.Type === 'Episode') {
        if (Object.keys(ids).length) return { episodes: [{ ...extra, ids }] };
        const sids = traktIds(item.SeriesProviderIds);
        if (Object.keys(sids).length && item.ParentIndexNumber != null && item.IndexNumber != null) {
            return { shows: [{ ids: sids, seasons: [{ number: item.ParentIndexNumber, episodes: [{ number: item.IndexNumber, ...extra }] }] }] };
        }
    }
    return null;
}
async function syncPost(path: string, body: any): Promise<boolean> {
    try { await refreshIfNeeded(); const r = await fetch(cfg().base + path, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) }); return r.ok; } catch { return false; }
}
export async function addToWatchlist(item: any): Promise<boolean> { if (!isConfigured() || !isLinked()) return false; const b = traktSyncBody(item, {}); if (!b) return false; return syncPost('/sync/watchlist', b); }
export async function removeFromWatchlist(item: any): Promise<boolean> { if (!isConfigured() || !isLinked()) return false; const b = traktSyncBody(item, {}); if (!b) return false; return syncPost('/sync/watchlist/remove', b); }
export async function rate(item: any, rating: number): Promise<boolean> { if (!isConfigured() || !isLinked()) return false; const b = traktSyncBody(item, { rating: Math.max(1, Math.min(10, Math.round(rating))) }); if (!b) return false; return syncPost('/sync/ratings', b); }
export async function unrate(item: any): Promise<boolean> { if (!isConfigured() || !isLinked()) return false; const b = traktSyncBody(item, {}); if (!b) return false; return syncPost('/sync/ratings/remove', b); }

// ---- scrobble wiring: listen to the web playbackManager and scrobble start/pause/stop ----
// (native ExoPlayer playback on Android bypasses playbackManager — that path scrobbles once the
// native player reports progress; tracked as a follow-up alongside native download progress.)
let wired = false;
export function initJpxTrakt(): void {
    if (wired) return; wired = true;
    let lastItem: any = null; let lastPct = 0; let ticker: any = null;
    import('components/playback/playbackmanager').then((mod: any) => {
        const pm = mod.playbackManager || mod.default;
        if (!pm) return;
        const pct = (player: any): number => { try { const cur = pm.getCurrentTicks(player); const dur = pm.duration(player); return dur ? Math.max(0, Math.min(100, cur / dur * 100)) : 0; } catch { return 0; } };
        const item = (player: any): any => { try { return pm.currentItem(player); } catch { return null; } };
        Events.on(pm, 'playbackstart', (_e: any, player: any) => {
            lastItem = item(player); lastPct = pct(player);
            if (lastItem) scrobble('start', lastItem, lastPct);
            if (ticker) clearInterval(ticker);
            ticker = setInterval(() => { try { lastPct = pct(player); } catch { /* ignore */ } }, 10000);
        });
        Events.on(pm, 'unpause', (_e: any, player: any) => { const it = item(player) || lastItem; if (it) scrobble('start', it, pct(player)); });
        Events.on(pm, 'pause', (_e: any, player: any) => { const it = item(player) || lastItem; const p = pct(player); lastPct = p; if (it) scrobble('pause', it, p); });
        Events.on(pm, 'playbackstop', (_e: any, info: any) => {
            if (ticker) { clearInterval(ticker); ticker = null; }
            let it = lastItem; let p = lastPct;
            try {
                if (info && info.item) { it = info.item; if (info.item.RunTimeTicks && info.positionTicks != null) p = info.positionTicks / info.item.RunTimeTicks * 100; }
                else if (info && info.nowPlayingItem) { it = info.nowPlayingItem; }
            } catch { /* ignore */ }
            if (it) scrobble('stop', it, p);
            lastItem = null; lastPct = 0;
        });
    }).catch(() => { /* playbackmanager not present */ });
}

try { (window as any).jpxTrakt = { isConfigured, isLinked, unlink, startDeviceAuth, pollDeviceToken, getMe, scrobble, scrobbleEnabled, setScrobbleEnabled, addToWatchlist, removeFromWatchlist, rate, unrate }; } catch { /* ignore */ }
