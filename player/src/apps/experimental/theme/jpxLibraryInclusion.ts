// Umbry — Per-server library inclusion (an allowlist, applied app-wide).
//
// When a user adds a media server (Jellyfin/Emby/Plex) they choose WHICH of that server's
// libraries are included in Umbry. Deselected libraries are excluded everywhere Umbry lists
// libraries — Home rows, the nav Libraries menu, library grids — not just hidden from Home
// (that is what jpxHomeLibraries does; this is stronger).
//
// State is PER-SERVER, keyed the SAME way jpxRowMinimize keys its per-server state, so the keys
// line up: Plex wins (localStorage `jpx-active-plex`, set to the Plex server id), else the live
// Jellyfin/Emby apiclient (serverId()), else the persisted `jpx-active-jf` marker.
//
// Pref shape (jpxPrefs key `includedLibrariesByServer`):
//   { "<serverKey>": ["<libraryId>", ...] }
// Semantics: NO entry for a server, or an EMPTY array, means "all included" (default). Only a
// NON-EMPTY array filters. So the picker stores [] when the user leaves everything checked (or
// unchecks everything) — that way future libraries are auto-included and we never hide everything.
// "Has this server been prompted?" is a separate question, answered by whether the KEY is present
// in the map at all (even with a [] value).
//
// Filtering happens at two choke points that mirror the Kids-Mode enforcement:
//   1. The SDK Api path — a response interceptor added in utils/jellyfin-apiclient/compat.ts toApi
//      (covers Home rows via homesections.js and the nav Libraries menu via libraryMenu.js, for
//      Jellyfin/Emby AND Plex, since both flow through toApi).
//   2. The legacy ApiClient.getUserViews path — ApiClient.prototype patched here (covers the nav
//      pill multi-server views and ItemsView), plus the Plex shim wrapped via wrapInclusion (called
//      from jpxPlexClient). The picker itself must see the FULL list, so it fetches inside
//      withRawViews(), which suspends this filter.

import { ApiClient } from 'jellyfin-apiclient';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { queryClient } from 'utils/query/queryClient';

import { getPref, setPref } from './jpxPrefs';

export const INCLUDED_LIBS_KEY = 'includedLibrariesByServer';

type Store = Record<string, string[]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function loadStore(): Store {
    const v = getPref<Store>(INCLUDED_LIBS_KEY, {});
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
function saveStore(s: Store): void {
    setPref(INCLUDED_LIBS_KEY, s);
}

// SAME resolution as jpxRowMinimize.activeServerId(), so the keys match. Plex first (its id lives in
// `jpx-active-plex`, set to the Plex server id at login), then the live JF/Emby apiclient, then the
// persisted jf marker.
export function activeServerId(): string {
    try {
        const plex = localStorage.getItem('jpx-active-plex');
        if (plex) return 'plex:' + plex;
    } catch (e) { /* ignore */ }
    try {
        const ac = ServerConnections.currentApiClient && ServerConnections.currentApiClient();
        const sid = ac && ac.serverId && ac.serverId();
        if (sid) return 'jf:' + sid;
    } catch (e) { /* ignore */ }
    try {
        const jf = JSON.parse(localStorage.getItem('jpx-active-jf') || 'null');
        if (jf && jf.id) return 'jf:' + jf.id;
    } catch (e) { /* ignore */ }
    return 'default';
}

// Per-instance server key for a SPECIFIC apiClient (correct even for a non-active server, e.g. the
// nav pill's multi-server view fetch). Plex shim -> plex:<id>; real ApiClient -> jf:<serverId>.
export function serverKeyForClient(client: AnyClient): string {
    try {
        if (client && client.__plex && typeof client.serverId === 'function') {
            const s = client.serverId();
            if (s) return 'plex:' + s;
        }
    } catch (e) { /* ignore */ }
    try {
        if (client && typeof client.serverId === 'function') {
            const s = client.serverId();
            if (s) return 'jf:' + s;
        }
    } catch (e) { /* ignore */ }
    return activeServerId();
}

// Has the user been prompted / made a choice for this server? True iff the key exists (even []).
export function hasSelectionFor(serverId: string): boolean {
    const s = loadStore();
    return Object.prototype.hasOwnProperty.call(s, serverId);
}

// The included library ids for a server, or null == "all included" (absent OR empty array).
export function includedLibraryIds(serverId: string = activeServerId()): string[] | null {
    const s = loadStore();
    const arr = s[serverId];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map(String);
}

// Persist the selection for a server. Pass the concrete included ids, or [] to mean "all".
export function setIncludedLibraryIds(serverId: string, ids: string[]): void {
    const s = loadStore();
    s[serverId] = (ids || []).map(String);
    saveStore(s);
}

// ---- Filtering ----
let bypass = 0;
// Run fn with the inclusion filter suspended (the picker needs the full library list). fn is called
// synchronously; our wrappers read `bypass` synchronously at call time, so a returned promise still
// resolves unfiltered even though we decrement right after.
export function withRawViews<T>(fn: () => T): T {
    bypass++;
    try { return fn(); } finally { bypass--; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filterItems(items: any[], serverId: string): any[] {
    const ids = includedLibraryIds(serverId);
    if (!ids) return items;                 // null == all -> untouched
    const set = new Set(ids);
    const filtered = items.filter(v => set.has(String((v && (v.Id ?? v.id)))));
    // Fail-safe: a saved selection that matches ZERO of the actual libraries is stale/mis-keyed (e.g.
    // written by an earlier build under the wrong server key, or after a library re-ID). NEVER black
    // out the whole app over it — show everything. A real partial selection always matches ≥1 library.
    if (filtered.length === 0 && items.length > 0) return items;
    return filtered;
}

// Filter a getUserViews-style result ({ Items: [...] }) for a specific server key. Pure; never
// throws. Empty/absent selection returns the result untouched.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filterViewsResult(res: any, serverId: string): any {
    try {
        if (!res || typeof res !== 'object' || !Array.isArray(res.Items)) return res;
        const filtered = filterItems(res.Items, serverId);
        if (filtered.length === res.Items.length) return res;
        return { ...res, Items: filtered, TotalRecordCount: filtered.length };
    } catch { return res; }
}

// ---- Legacy ApiClient.getUserViews patch (JF/Emby) ----
function wrapLegacyViews(): void {
    const proto = ApiClient.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = proto.getUserViews;
    if (typeof orig !== 'function') return;
    const flag = '__jpxInclusionWrapped_getUserViews';
    if ((proto as unknown as Record<string, boolean>)[flag]) return;
    proto.getUserViews = function patched(this: AnyClient, ...args: unknown[]) {
        const out = orig.apply(this, args);
        if (bypass > 0) return out;
        const key = serverKeyForClient(this);
        if (out && typeof (out as Promise<unknown>).then === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (out as Promise<any>).then(r => filterViewsResult(r, key));
        }
        return out;
    };
    (proto as unknown as Record<string, boolean>)[flag] = true;
}

// ---- Plex shim wrap (called from jpxPlexClient, after wrapKidsMode) ----
export function wrapInclusion(client: AnyClient): AnyClient {
    if (!client || client.__jpxInclusionWrapped) return client;
    const gv = client.getUserViews;
    if (typeof gv === 'function') {
        client.getUserViews = function wrapped(this: AnyClient, ...args: unknown[]) {
            const out = (gv as (...a: unknown[]) => unknown).apply(client, args);
            if (bypass > 0) return out;
            const key = serverKeyForClient(client);
            if (out && typeof (out as Promise<unknown>).then === 'function') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (out as Promise<any>).then(r => filterViewsResult(r, key));
            }
            return out;
        };
    }
    client.__jpxInclusionWrapped = true;
    return client;
}

let installed = false;
export function installLibraryInclusion(): void {
    if (installed) return;
    installed = true;
    try { wrapLegacyViews(); } catch (e) { console.error('[jpxInclusion] install failed', e); }
}

// After a selection changes, re-run the library-listing queries so Home + nav update without a full
// reload. The SDK views results are react-query cached (post-filter), so we invalidate them; then we
// nudge the home sections + nav to recompute.
export function refreshLibraryViews(): void {
    try {
        queryClient.invalidateQueries({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'User' && q.queryKey.includes('Views')
        });
    } catch (e) { /* ignore */ }
    try { document.querySelector('.sections')?.dispatchEvent(new CustomEvent('settingschange', { bubbles: true })); } catch (e) { /* ignore */ }
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
}
