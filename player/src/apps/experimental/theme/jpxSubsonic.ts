// Umbry — Subsonic / Navidrome adapter. Talks directly to a Subsonic-API server (Navidrome,
// Airsonic, Gonic, …) over its HTTP REST API and maps the responses into Jellyfin-shaped objects
// so the music content renders natively in the app — same pattern as the Plex adapter (no bridge,
// no routing). Navidrome sends permissive CORS, so the browser can fetch it directly.
// Registered servers live in localStorage under `jpx-subsonic-servers`; ids/keys are namespaced.

import { schedulePush } from './jpxCloud';

/* eslint-disable no-bitwise */
// Compact, self-contained MD5 (Subsonic token auth needs md5(password + salt); @noble/hashes has
// no md5). Public-domain blueimp/Joseph-Myers implementation. Verified against known vectors.
function md5(input: string): string {
    function safeAdd(x: number, y: number): number { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
    function rol(n: number, c: number): number { return (n << c) | (n >>> (32 - c)); }
    function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    function core(x: number[], len: number): number[] {
        x[len >> 5] |= 0x80 << (len % 32);
        x[(((len + 64) >>> 9) << 4) + 14] = len;
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (let i = 0; i < x.length; i += 16) {
            const oa = a, ob = b, oc = c, od = d;
            a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
            a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
            a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
            a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
            a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
        }
        return [a, b, c, d];
    }
    function toHex(bin: number[]): string { const h = '0123456789abcdef'; let s = ''; for (let i = 0; i < bin.length * 4; i++) { s += h.charAt((bin[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) + h.charAt((bin[i >> 2] >> ((i % 4) * 8)) & 0xf); } return s; }
    function toBin(str: string): number[] { const bin: number[] = []; for (let i = 0; i < str.length * 8; i += 8) { bin[i >> 5] |= (str.charCodeAt(i / 8) & 0xff) << (i % 32); } return bin; }
    const utf8 = unescape(encodeURIComponent(input));
    return toHex(core(toBin(utf8), utf8.length * 8));
}
/* eslint-enable no-bitwise */

export interface SubsonicServer { id: string; name: string; base: string; user: string; password: string; kind?: 'navidrome' | 'subsonic'; }
type Dict = Record<string, unknown>;

const KEY = 'jpx-subsonic-servers';
const API_VERSION = '1.16.1';
const CLIENT = 'umbry';

export function getSubsonicServers(): SubsonicServer[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') as SubsonicServer[]; } catch { return []; }
}
function saveSubsonicServers(list: SubsonicServer[]): void {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
    try { schedulePush(); } catch { /* ignore */ }
}
export function getSubsonicServer(id: string): SubsonicServer | undefined {
    return getSubsonicServers().find(s => s.id === id);
}
export function addSubsonicServer(srv: SubsonicServer): void {
    const list = getSubsonicServers().filter(s => s.id !== srv.id);
    list.push(srv);
    saveSubsonicServers(list);
}
export function removeSubsonicServer(id: string): void {
    saveSubsonicServers(getSubsonicServers().filter(s => s.id !== id));
    try { if (localStorage.getItem('jpx-active-subsonic') === id) localStorage.removeItem('jpx-active-subsonic'); } catch { /* ignore */ }
}

function randomSalt(): string {
    let s = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 12; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
}

/** Build an authenticated Subsonic REST URL (token+salt auth, JSON output). */
export function subsonicUrl(srv: { base: string; user: string; password: string }, method: string, params: Record<string, string | number | undefined> = {}): string {
    const salt = randomSalt();
    const token = md5(srv.password + salt);
    const base = srv.base.replace(/\/+$/, '');
    const qs = new URLSearchParams({ u: srv.user, t: token, s: salt, v: API_VERSION, c: CLIENT, f: 'json' });
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== null) qs.set(k, String(v)); }
    return `${base}/rest/${method}.view?${qs.toString()}`;
}

/** A raw, non-JSON URL (stream / cover art) — the browser/player hits it directly. */
export function subsonicMediaUrl(srv: SubsonicServer, method: string, params: Record<string, string | number | undefined> = {}): string {
    return subsonicUrl(srv, method, params);
}

async function subsonicGet(srv: SubsonicServer, method: string, params: Record<string, string | number | undefined> = {}): Promise<Dict> {
    const r = await fetch(subsonicUrl(srv, method, params), { headers: { Accept: 'application/json' } });
    const j = await r.json() as Dict;
    const resp = (j['subsonic-response'] || {}) as Dict;
    if (resp.status !== 'ok') {
        const err = (resp.error || {}) as Dict;
        throw new Error(String(err.message || 'Subsonic error') + (err.code ? ` (${err.code})` : ''));
    }
    return resp;
}

/** Verify a server is reachable + credentials valid. Returns the server 'kind' on success. */
export async function pingSubsonic(base: string, user: string, password: string): Promise<{ ok: boolean; kind?: string; error?: string }> {
    try {
        const r = await fetch(subsonicUrl({ base, user, password }, 'ping'), { headers: { Accept: 'application/json' } });
        const j = await r.json() as Dict;
        const resp = (j['subsonic-response'] || {}) as Dict;
        if (resp.status === 'ok') return { ok: true, kind: String(resp.type || 'subsonic') };
        const err = (resp.error || {}) as Dict;
        return { ok: false, error: String(err.message || 'Authentication failed') };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
}

// ---- response → Jellyfin-shape mapping ------------------------------------------------
const NS = (srv: SubsonicServer, id: string) => `sub_${srv.id}_${id}`;
const ticks = (secs?: number) => secs ? Math.round(secs * 10000000) : undefined;

export function mapAlbum(srv: SubsonicServer, a: Dict): Dict {
    return {
        Id: NS(srv, String(a.id)), ServerId: `subsonic_${srv.id}`, Name: String(a.name || a.title || ''),
        Type: 'MusicAlbum', AlbumArtist: a.artist ? String(a.artist) : undefined, AlbumArtists: a.artist ? [{ Name: String(a.artist), Id: a.artistId ? NS(srv, String(a.artistId)) : undefined }] : [],
        ProductionYear: a.year ? Number(a.year) : undefined, ChildCount: a.songCount ? Number(a.songCount) : undefined,
        RunTimeTicks: ticks(a.duration as number), __subCover: a.coverArt ? String(a.coverArt) : undefined,
        ImageTags: a.coverArt ? { Primary: String(a.coverArt) } : {}
    };
}
export function mapArtist(srv: SubsonicServer, a: Dict): Dict {
    return {
        Id: NS(srv, String(a.id)), ServerId: `subsonic_${srv.id}`, Name: String(a.name || ''),
        Type: 'MusicArtist', ChildCount: a.albumCount ? Number(a.albumCount) : undefined,
        __subCover: a.coverArt ? String(a.coverArt) : undefined, ImageTags: a.coverArt ? { Primary: String(a.coverArt) } : {}
    };
}
export function mapSong(srv: SubsonicServer, s: Dict): Dict {
    return {
        Id: NS(srv, String(s.id)), ServerId: `subsonic_${srv.id}`, Name: String(s.title || ''),
        Type: 'Audio', Album: s.album ? String(s.album) : undefined, AlbumId: s.albumId ? NS(srv, String(s.albumId)) : undefined,
        Artists: s.artist ? [String(s.artist)] : [], ArtistItems: s.artistId ? [{ Name: String(s.artist), Id: NS(srv, String(s.artistId)) }] : [],
        IndexNumber: s.track ? Number(s.track) : undefined, ProductionYear: s.year ? Number(s.year) : undefined,
        RunTimeTicks: ticks(s.duration as number), __subCover: s.coverArt ? String(s.coverArt) : undefined,
        __subStreamId: String(s.id), MediaType: 'Audio', ImageTags: s.coverArt ? { Primary: String(s.coverArt) } : {}
    };
}

// ---- high-level browse -----------------------------------------------------------------
export async function getAlbums(srv: SubsonicServer, type = 'newest', size = 50, offset = 0): Promise<Dict[]> {
    const resp = await subsonicGet(srv, 'getAlbumList2', { type, size, offset });
    const list = ((resp.albumList2 as Dict || {}).album || []) as Dict[];
    return list.map(a => mapAlbum(srv, a));
}
export async function getArtists(srv: SubsonicServer): Promise<Dict[]> {
    const resp = await subsonicGet(srv, 'getArtists');
    const idx = ((resp.artists as Dict || {}).index || []) as Dict[];
    const out: Dict[] = [];
    for (const g of idx) for (const a of ((g.artist || []) as Dict[])) out.push(mapArtist(srv, a));
    return out;
}
export async function getAlbum(srv: SubsonicServer, albumId: string): Promise<{ album: Dict; songs: Dict[] }> {
    const raw = albumId.replace(`sub_${srv.id}_`, '');
    const resp = await subsonicGet(srv, 'getAlbum', { id: raw });
    const a = (resp.album || {}) as Dict;
    return { album: mapAlbum(srv, a), songs: ((a.song || []) as Dict[]).map(s => mapSong(srv, s)) };
}
export async function getPlaylists(srv: SubsonicServer): Promise<Dict[]> {
    const resp = await subsonicGet(srv, 'getPlaylists');
    const list = ((resp.playlists as Dict || {}).playlist || []) as Dict[];
    return list.map(p => ({ Id: NS(srv, String(p.id)), ServerId: `subsonic_${srv.id}`, Name: String(p.name || ''), Type: 'Playlist', ChildCount: p.songCount ? Number(p.songCount) : undefined, __subCover: p.coverArt ? String(p.coverArt) : undefined }));
}
export async function search(srv: SubsonicServer, query: string): Promise<{ albums: Dict[]; artists: Dict[]; songs: Dict[] }> {
    const resp = await subsonicGet(srv, 'search3', { query, songCount: 30, albumCount: 20, artistCount: 20 });
    const r = (resp.searchResult3 || {}) as Dict;
    return {
        albums: ((r.album || []) as Dict[]).map(a => mapAlbum(srv, a)),
        artists: ((r.artist || []) as Dict[]).map(a => mapArtist(srv, a)),
        songs: ((r.song || []) as Dict[]).map(s => mapSong(srv, s))
    };
}

/** Playback stream URL for a mapped song (uses the raw Subsonic id). */
export function streamUrl(srv: SubsonicServer, streamId: string): string {
    return subsonicMediaUrl(srv, 'stream', { id: streamId, maxBitRate: 0 });
}
/** Cover-art URL for a coverArt id. */
export function coverArtUrl(srv: SubsonicServer, coverId: string, size = 400): string {
    return subsonicMediaUrl(srv, 'getCoverArt', { id: coverId, size });
}
