// Umbry Parental Controls — a Umbry-native Kids Mode + PIN system.
//
// This is deliberately client-side and independent of Jellyfin's own account/user-policy parental
// controls: turning on Kids Mode filters what Umbry shows (by maturity rating + hidden
// libraries) and requires a PIN to leave. Nothing here touches the Jellyfin account's server-side
// policy, so it never affects the official Jellyfin app or other clients — and because the PIN and
// rules are stored through jpxPrefs (mirrored to the user's DisplayPreferences), they follow the
// account across devices. PIN is stored hashed (SHA-256 over a per-user random salt), never plain.
//
// Enforcement covers Jellyfin/Emby (ApiClient prototype patch, jpxParentalEnforce) and Plex (the
// per-server shim, via wrapKidsMode below).

import { getPref, setPref, subscribePrefs } from './jpxPrefs';
import { del as idbDel } from 'idb-keyval';
import { queryClient } from 'utils/query/queryClient';

// ---- Pref keys (all synced through jpxPrefs) ----
export const PIN_HASH = 'pref_parental_pin_hash';
export const PIN_SALT = 'pref_parental_pin_salt';
export const KIDS_ACTIVE = 'pref_kids_mode_active';
export const KIDS_MAX_LEVEL = 'pref_kids_max_level';       // 1..4, see LADDER
export const KIDS_BLOCK_UNRATED = 'pref_kids_block_unrated';
export const KIDS_HIDDEN_LIBS = 'pref_kids_hidden_libraries'; // string[] of library ItemIds
export const KIDS_BLOCKED_TERMS = 'pref_kids_blocked_terms';   // string[] of genres/tags to block
export const KIDS_RESTRICTION_MODE = 'pref_kids_restriction_mode'; // 'hide' | 'lock'

// ---- Maturity ladder ----
// Four coarse levels mapping the common rating strings across MPAA / US-TV / BBFC / numeric systems.
// Unknown-but-present ratings are treated as the top level (blocked in Kids Mode) so an unusual
// label can't slip adult content through; genuinely unrated (empty) items are governed by the
// "block unrated" toggle instead.
export const LADDER: Array<{ level: number; label: string; ratings: string[] }> = [
    { level: 1, label: 'Little Kids', ratings: [ 'g', 'tv-g', 'tv-y', 'u', 'uc', 'e', 'ec', 'all', 'approved', 'passed', '0', '3' ] },
    { level: 2, label: 'Older Kids', ratings: [ 'pg', 'tv-pg', 'tv-y7', 'tv-y7-fv', '6', '7', '9', '10', 'gp' ] },
    { level: 3, label: 'Teens', ratings: [ 'pg-13', 'tv-14', '12', '12a', '13', '14', '15', '16', 'm', 'm/pg', 'ma-15' ] },
    { level: 4, label: 'Mature', ratings: [ 'r', 'nc-17', 'tv-ma', '17', '18', '18a', 'r18', 'x', 'xxx', 'ao', 'adults only', 'nr-18' ] }
];

export const MAX_LEVEL = 4;
const RATING_TO_LEVEL: Record<string, number> = (() => {
    const m: Record<string, number> = {};
    for (const tier of LADDER) for (const r of tier.ratings) m[r] = tier.level;
    return m;
})();

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// "Block Unrated" targets video, where a missing rating can mean an adult movie. Unrated audio and
// books (which rarely carry ratings) stay allowed, so Kids Mode doesn't wipe out Music/Books.
const VIDEO_TYPES = new Set([ 'Movie', 'Episode', 'Series', 'Season', 'Video', 'MusicVideo', 'Trailer', 'Program', 'Recording', 'LiveTvProgram', 'TvChannel' ]);
function isVideoItem(item: Record<string, unknown>): boolean {
    if (item.MediaType === 'Video') return true;
    if (item.MediaType === 'Audio') return false;
    return VIDEO_TYPES.has(String(item.Type || ''));
}

export function ratingLevel(officialRating: unknown): number {
    const r = norm(officialRating);
    if (!r) return 0;
    if (r in RATING_TO_LEVEL) return RATING_TO_LEVEL[r];
    const compact = r.replace(/[^a-z0-9-]/g, '');
    if (compact in RATING_TO_LEVEL) return RATING_TO_LEVEL[compact];
    return MAX_LEVEL;
}

// ---- Kids Mode state ----
export function kidsModeActive(): boolean {
    return getPref<boolean>(KIDS_ACTIVE, false) === true;
}
export function maxLevel(): number {
    const v = Number(getPref<number>(KIDS_MAX_LEVEL, 3));
    return Number.isFinite(v) ? Math.min(MAX_LEVEL, Math.max(1, v)) : 3;
}
export function blockUnrated(): boolean {
    return getPref<boolean>(KIDS_BLOCK_UNRATED, true) === true;
}
export function hiddenLibraryIds(): string[] {
    const v = getPref<string[]>(KIDS_HIDDEN_LIBS, []);
    return Array.isArray(v) ? v.map(String) : [];
}

// Libraries auto-hidden this session because every item in them is blocked by the current rules
// (an all-adult / all-unrated library). Recomputed when the rules signature changes; see
// ensureAutoHidden(). Kept separate from the manual list so clearing manual doesn't wipe auto.
let autoHidden = new Set<string>();
let autoSig = '__none__';

export function isLibraryAutoHidden(id: unknown): boolean {
    return !!id && autoHidden.has(String(id));
}
// A library is hidden if the user hid it OR it is fully blocked (auto).
export function isLibraryHidden(id: unknown): boolean {
    if (!id) return false;
    const s = String(id);
    return hiddenLibraryIds().includes(s) || autoHidden.has(s);
}

// ---- Content rules (maturity rating + blocked genres/tags) ----
export function blockedTerms(): string[] {
    const v = getPref<string[]>(KIDS_BLOCKED_TERMS, []);
    return Array.isArray(v) ? v.map(t => norm(t)).filter(Boolean) : [];
}
// 'hide' (default) removes restricted items from view; 'lock' leaves them visible but PIN-gated.
export function restrictionMode(): 'hide' | 'lock' {
    return getPref<string>(KIDS_RESTRICTION_MODE, 'hide') === 'lock' ? 'lock' : 'hide';
}

// Blocked by maturity rating alone.
function ratingBlocks(item: Record<string, unknown>): boolean {
    const lvl = ratingLevel(item.OfficialRating);
    if (lvl === 0) return isVideoItem(item) ? blockUnrated() : false;
    return lvl > maxLevel();
}
// Carries a blocked genre or tag.
function termBlocks(item: Record<string, unknown>): boolean {
    const terms = blockedTerms();
    if (!terms.length) return false;
    const bag: string[] = [];
    const pushArr = (arr: unknown) => { if (Array.isArray(arr)) for (const x of arr) bag.push(norm(x)); };
    const pushNamed = (arr: unknown) => { if (Array.isArray(arr)) for (const x of arr) bag.push(norm((x as Record<string, unknown>)?.Name)); };
    pushArr(item.Genres); pushArr(item.Tags);
    pushNamed(item.GenreItems); pushNamed(item.TagItems);
    return terms.some(term => bag.includes(term));
}
// Blocked by the content rules (rating OR genre/tag). Ignores hidden-library membership.
export function isContentBlocked(item: Record<string, unknown> | null | undefined): boolean {
    if (!item) return false;
    return ratingBlocks(item) || termBlocks(item);
}
// Lives in a manual- or auto-hidden library.
export function isHiddenLibraryItem(item: Record<string, unknown> | null | undefined): boolean {
    if (!item) return false;
    const parent = (item.ParentId ?? item.SeriesId ?? item.CollectionId) as unknown;
    return isLibraryHidden(item.Id) || isLibraryHidden(parent);
}

// Fully allowed (nothing blocks it). Used by the deep-link guard.
export function itemAllowed(item: Record<string, unknown> | null | undefined): boolean {
    if (!kidsModeActive() || !item) return true;
    return !isHiddenLibraryItem(item) && !isContentBlocked(item);
}

// Should this item appear in a LIST (home rows / grids / search)? Hidden-library items are always
// removed; rating/genre-blocked items are removed only in "hide" mode (in "lock" mode they stay
// visible and get PIN-gated when opened).
export function itemVisibleInList(item: Record<string, unknown> | null | undefined): boolean {
    if (!kidsModeActive() || !item) return true;
    if (isHiddenLibraryItem(item)) return false;
    if (restrictionMode() === 'lock') return true;
    return !isContentBlocked(item);
}

export function filterItems<T extends Record<string, unknown>>(items: T[] | null | undefined): T[] {
    if (!kidsModeActive() || !Array.isArray(items)) return (items as T[]) || [];
    return items.filter(it => itemVisibleInList(it));
}

// ---- List/view result filtering (shared by the Jellyfin patch and the Plex shim wrapper) ----
type AnyItem = Record<string, unknown>;
type ListResult = { Items?: AnyItem[]; TotalRecordCount?: number; __rawCount?: number } | AnyItem[] | null | undefined;

export function filterListResult(res: ListResult): ListResult {
    if (!kidsModeActive() || !res) return res;
    if (Array.isArray(res)) return res.filter(it => itemVisibleInList(it));
    if (Array.isArray(res.Items)) {
        const rawCount = res.Items.length;
        const kept = res.Items.filter(it => itemVisibleInList(it));
        res.__rawCount = rawCount; // pre-filter size, so ensureAutoHidden can tell "all blocked" from "empty"
        res.Items = kept;
        if (typeof res.TotalRecordCount === 'number') res.TotalRecordCount = Math.max(0, res.TotalRecordCount - (rawCount - kept.length));
    }
    return res;
}

export function filterViewsResult(res: ListResult): ListResult {
    if (!kidsModeActive() || !res || Array.isArray(res) || !Array.isArray(res.Items)) return res;
    res.Items = res.Items.filter(v => !isLibraryHidden(v.Id));
    return res;
}

// Signature of the inputs that determine the auto-hidden set; recompute only when it changes.
function autoHiddenSignature(client: Record<string, unknown>): string {
    let serverId = '';
    try { serverId = String((client.serverId as (() => string) | undefined)?.() || ''); } catch { /* ignore */ }
    return [ serverId, maxLevel(), blockUnrated(), hiddenLibraryIds().join(','), blockedTerms().join(',') ].join('|');
}

// Determine which of the given library views are fully blocked (zero kid-allowed items) and mark
// them auto-hidden. Uses a random sample per library; a library that has ANY allowed item is kept.
// A truly empty library (raw 0) is left visible. Cached by signature so this runs at most once per
// rules/server combination.
async function ensureAutoHidden(client: Record<string, unknown>, views: AnyItem[]): Promise<void> {
    if (!kidsModeActive()) return;
    const sig = autoHiddenSignature(client);
    if (sig === autoSig) return;
    const getItems = client.getItems as ((u: string, q: Record<string, unknown>) => Promise<ListResult>) | undefined;
    const getUid = client.getCurrentUserId as (() => string) | undefined;
    if (typeof getItems !== 'function' || typeof getUid !== 'function') { autoSig = sig; return; }
    const userId = getUid.call(client);
    // Clear first so the hidden-library membership check can't keep a library sticky across recomputes.
    autoHidden = new Set<string>();
    const next = new Set<string>();
    await Promise.all(views.map(async (v) => {
        const id = String(v.Id);
        try {
            const r = await getItems.call(client, userId, {
                ParentId: id, Recursive: true, Limit: 200, SortBy: 'Random',
                Fields: 'OfficialRating', EnableTotalRecordCount: false
            });
            const items = (r && !Array.isArray(r) && Array.isArray(r.Items)) ? r.Items : [];
            const raw = (r && !Array.isArray(r) && typeof r.__rawCount === 'number') ? r.__rawCount : items.length;
            // getItems is wrapped to filter by rating already, so `items` is the allowed set; but to be
            // robust if called on an unwrapped client, re-check by rating here too.
            const anyAllowed = items.some(it => !isContentBlocked(it as AnyItem));
            if (raw > 0 && !anyAllowed) next.add(id);
        } catch { /* leave library visible on query failure */ }
    }));
    autoHidden = next;
    autoSig = sig;
}

// Async view filter: ensure the auto-hidden set is computed for the current rules, then drop hidden
// (manual + auto) libraries. Awaited inside getUserViews so the adult tile never flashes.
export async function applyViewsFilter(client: Record<string, unknown>, res: ListResult): Promise<ListResult> {
    if (!kidsModeActive() || !res || Array.isArray(res) || !Array.isArray(res.Items)) return res;
    try { await ensureAutoHidden(client, res.Items); } catch { /* ignore */ }
    return filterViewsResult(res);
}

// Wrap a plain apiClient-like object (the Plex shim) so its list methods honor Kids Mode. Idempotent.
export function wrapKidsMode(client: Record<string, unknown>): Record<string, unknown> {
    if (!client || client.__jpxKidsWrapped) return client;
    const wrapList = (name: string) => {
        const orig = client[name];
        if (typeof orig !== 'function') return;
        client[name] = function wrapped(this: unknown, ...args: unknown[]) {
            const out = (orig as (...a: unknown[]) => unknown).apply(client, args);
            if (out && typeof (out as Promise<unknown>).then === 'function') {
                return (out as Promise<ListResult>).then(r => filterListResult(r));
            }
            return out;
        };
    };
    [ 'getItems', 'getResumeItems', 'getNextUpEpisodes', 'getLatestItems' ].forEach(wrapList);
    const gv = client.getUserViews;
    if (typeof gv === 'function') {
        client.getUserViews = function wrappedViews(this: unknown, ...args: unknown[]) {
            const out = (gv as (...a: unknown[]) => unknown).apply(client, args);
            if (out && typeof (out as Promise<unknown>).then === 'function') {
                return (out as Promise<ListResult>).then(r => applyViewsFilter(client, r));
            }
            return out;
        };
    }
    client.__jpxKidsWrapped = true;
    return client;
}

// ---- PIN ----
const enc = new TextEncoder();
function randomSalt(): string {
    const a = new Uint8Array(16);
    (globalThis.crypto || window.crypto).getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Pure-JS SHA-256 (same digest as crypto.subtle) for NON-SECURE contexts. crypto.subtle is only
// defined over HTTPS/localhost; over plain http:// (e.g. the LAN dev server) it is undefined, which
// made setPin/verifyPin throw and left the PIN dialog hung with no way to apply the entry.
function sha256Hex(bytes: Uint8Array): string {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const l = bytes.length;
    const bitLen = l * 8;
    const withOne = l + 1;
    const k = (56 - (withOne % 64) + 64) % 64;
    const total = withOne + k + 8;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[l] = 0x80;
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    m[total - 8] = (hi >>> 24) & 0xff; m[total - 7] = (hi >>> 16) & 0xff; m[total - 6] = (hi >>> 8) & 0xff; m[total - 5] = hi & 0xff;
    m[total - 4] = (lo >>> 24) & 0xff; m[total - 3] = (lo >>> 16) & 0xff; m[total - 2] = (lo >>> 8) & 0xff; m[total - 1] = lo & 0xff;
    const w = new Uint32Array(64);
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = ((m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | (m[off + i * 4 + 3])) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    const hx = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
    return hx(h0) + hx(h1) + hx(h2) + hx(h3) + hx(h4) + hx(h5) + hx(h6) + hx(h7);
}
async function hash(pin: string, salt: string): Promise<string> {
    const data = enc.encode(salt + ':' + pin);
    const subtle = (globalThis.crypto || window.crypto)?.subtle;
    if (subtle && typeof subtle.digest === 'function') {
        const buf = await subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Non-secure (http://) context: crypto.subtle is undefined — fall back to the JS SHA-256.
    return sha256Hex(data);
}

export function hasPin(): boolean {
    return !!getPref<string>(PIN_HASH, '') && !!getPref<string>(PIN_SALT, '');
}
export async function setPin(pin: string): Promise<void> {
    const salt = randomSalt();
    const h = await hash(pin, salt);
    setPref(PIN_SALT, salt);
    setPref(PIN_HASH, h);
}
export async function verifyPin(pin: string): Promise<boolean> {
    const salt = getPref<string>(PIN_SALT, '');
    const stored = getPref<string>(PIN_HASH, '');
    if (!salt || !stored) return false;
    const h = await hash(pin, salt);
    if (h.length !== stored.length) return false;
    let diff = 0;
    for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.charCodeAt(i);
    return diff === 0;
}
export function clearPin(): void {
    setPref(PIN_HASH, '');
    setPref(PIN_SALT, '');
}

// Kids Mode changes what every list query is allowed to return, but react-query persists its
// results to IndexedDB (see utils/query/queryClient), so after a reload the app rehydrates the
// PREVIOUS (unfiltered) results and the enforcement interceptor never re-runs on them. Clearing
// both the in-memory cache and the persisted copy before the reload forces fresh, filtered
// fetches. Key must match createIDBPersister('jellyfin-query-cache').
export async function purgeQueryCaches(): Promise<void> {
    try { queryClient.clear(); } catch { /* ignore */ }
    try { await idbDel('jellyfin-query-cache'); } catch { /* ignore */ }
}

// ---- Mode transitions ----
export function enterKidsMode(): void {
    autoSig = '__none__'; // force auto-hidden recompute on next getUserViews
    setPref(KIDS_ACTIVE, true);
    notify();
}
// Caller must have already verified the PIN (or there is no PIN set).
export function exitKidsMode(): void {
    setPref(KIDS_ACTIVE, false);
    autoHidden = new Set<string>();
    autoSig = '__none__';
    notify();
}

// ---- Reactivity ----
function notify(): void {
    try { document.body.classList.toggle('jpx-kids-mode', kidsModeActive()); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('jpx-kids-mode-changed', { detail: { active: kidsModeActive() } })); } catch { /* ignore */ }
    try { document.querySelector('.sections')?.dispatchEvent(new CustomEvent('settingschange', { bubbles: true })); } catch { /* ignore */ }
}

// Recompute the auto-hidden set whenever a rule that affects it changes while Kids Mode is on.
subscribePrefs((key) => {
    if (key === KIDS_ACTIVE) {
        try { document.body.classList.toggle('jpx-kids-mode', kidsModeActive()); } catch { /* ignore */ }
    }
    if (key === KIDS_MAX_LEVEL || key === KIDS_BLOCK_UNRATED || key === KIDS_HIDDEN_LIBS || key === KIDS_BLOCKED_TERMS) {
        autoSig = '__none__';
    }
});

export function initParental(): void {
    try { document.body.classList.toggle('jpx-kids-mode', kidsModeActive()); } catch { /* ignore */ }
}
