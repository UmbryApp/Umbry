// =====================================================================================
// Umbry — client-side reading-progress store. Some servers don't persist a book resume
// position (verified: EMBY discards book PlaybackPositionTicks entirely; Plex has no book
// playstate either), so the reader also records progress locally, keyed by serverId+itemId,
// most-recent-first. The Books home merges this with the server's own resumable list so
// "Continue Reading" works uniformly across Jellyfin / Emby / Plex.
// =====================================================================================
const KEY = 'jpx-continue-reading';
const CAP = 40;

function readAll() {
    try {
        const a = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
}

export function loadReadingProgress(serverId) {
    const all = readAll();
    return serverId ? all.filter(e => e && e.sid === serverId) : all;
}

export function saveReadingProgress(item, pct) {
    if (!item || !item.Id) return;
    try {
        const sid = item.ServerId || '';
        let all = readAll().filter(e => e && !(e.sid === sid && e.id === item.Id));
        const p = Math.max(0, Math.min(1, Number(pct) || 0));
        // drop finished books from the list instead of parking them at ~100%
        if (p < 0.985) {
            const tag = item.ImageTags && item.ImageTags.Primary;
            all.unshift({ sid, id: item.Id, name: item.Name || '', type: item.Type || 'Book', tag: tag || null, pct: p, ts: Date.now() });
        }
        if (all.length > CAP) all = all.slice(0, CAP);
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
}

export default saveReadingProgress;
