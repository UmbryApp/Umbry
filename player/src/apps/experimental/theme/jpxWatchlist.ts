// Umbry-native Watchlist.
//
// Stored as a single synced pref (`jpx-pref-watchlist`), so it is identical across
// Jellyfin / Emby / Plex (unlike each server's own favourites/watchlist constructs) and
// follows the Umbry account to every device — jpxCloud already syncs all prefs.
// Each entry: { s: serverId, i: itemId, t: type, n: name, at: addedMs }.
import { getPref, setPref, subscribePrefs } from './jpxPrefs';

const WL_KEY = 'watchlist';

export interface WatchEntry { s: string; i: string; t?: string; n?: string; at: number; }

export function getWatchlist(): WatchEntry[] {
    const v = getPref<WatchEntry[]>(WL_KEY, []);
    return Array.isArray(v) ? v : [];
}

// An entry with no server id (legacy) matches any server; otherwise the server must match.
function sameEntry(e: WatchEntry, serverId: string, itemId: string): boolean {
    return e.i === itemId && (!e.s || !serverId || e.s === serverId);
}

export function isInWatchlist(serverId: string, itemId: string): boolean {
    if (!itemId) return false;
    return getWatchlist().some(e => sameEntry(e, serverId, itemId));
}

export function watchlistIdsForServer(serverId: string): string[] {
    return getWatchlist()
        .filter(e => !e.s || !serverId || e.s === serverId)
        .map(e => e.i);
}

// Toggle membership. Returns the new state (true = now in the watchlist).
export function toggleWatchlist(item: { Id: string; ServerId?: string; Type?: string; Name?: string }): boolean {
    const id = item && item.Id;
    if (!id) return false;
    const sid = item.ServerId || '';
    const list = getWatchlist();
    const idx = list.findIndex(e => sameEntry(e, sid, id));
    let nowIn: boolean;
    if (idx >= 0) {
        list.splice(idx, 1);
        nowIn = false;
    } else {
        list.unshift({ s: sid, i: id, t: item.Type, n: item.Name, at: Date.now() });
        nowIn = true;
    }
    setPref(WL_KEY, list);
    import('./jpxScrobbleSync').then(m => m.syncWatchlist(item, nowIn)).catch(() => { /* ignore */ });
    return nowIn;
}

export function subscribeWatchlist(cb: () => void): () => void {
    return subscribePrefs(() => cb());
}
