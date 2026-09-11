/* eslint-disable @typescript-eslint/no-explicit-any */
// Umbry — pushes watchlist changes and user ratings to whichever scrobble services are linked
// (Simkl and/or Trakt). Called from the native watchlist toggle and the detail-page Rate control.
// Items need external ids (imdb/tmdb/tvdb); if the caller passed a light item, we fetch the full one.
import { ServerConnections } from 'lib/jellyfin-apiclient';
import * as simkl from './jpxSimkl';
import * as trakt from './jpxTrakt';

async function ensureIds(item: any): Promise<any> {
    if (item && item.ProviderIds && Object.keys(item.ProviderIds).length) return item;
    try {
        const sc = ServerConnections as any;
        const ac = item.ServerId ? sc.getApiClient(item.ServerId) : sc.currentApiClient();
        if (!ac || typeof ac.getItem !== 'function') return item;
        const full = await ac.getItem(ac.getCurrentUserId(), item.Id);
        return full || item;
    } catch { return item; }
}

export async function syncWatchlist(item: any, add: boolean): Promise<void> {
    const it = await ensureIds(item);
    if (simkl.isLinked()) { void (add ? simkl.addToWatchlist(it) : simkl.removeFromWatchlist(it)); }
    if (trakt.isLinked()) { void (add ? trakt.addToWatchlist(it) : trakt.removeFromWatchlist(it)); }
}

// ---- local user ratings (also the source of truth for the Rate button label) ----
const RKEY = 'jpx-ratings';
function ratings(): Record<string, number> { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } }
export function getRating(serverId: string, itemId: string): number { return ratings()[(serverId || '') + '_' + itemId] || 0; }
function saveRating(serverId: string, itemId: string, n: number) {
    try { const r = ratings(); const k = (serverId || '') + '_' + itemId; if (n) r[k] = n; else delete r[k]; localStorage.setItem(RKEY, JSON.stringify(r)); } catch { /* ignore */ }
}
// rating 1-10, or 0 to clear.
export async function syncRating(item: any, rating: number): Promise<void> {
    saveRating(item.ServerId, item.Id, rating);
    const it = await ensureIds(item);
    if (simkl.isLinked()) { void (rating ? simkl.rate(it, rating) : simkl.unrate(it)); }
    if (trakt.isLinked()) { void (rating ? trakt.rate(it, rating) : trakt.unrate(it)); }
}

export function anyLinked(): boolean { return simkl.isLinked() || trakt.isLinked(); }

try { (window as any).jpxScrobbleSync = { syncWatchlist, syncRating, getRating, anyLinked }; } catch { /* ignore */ }
