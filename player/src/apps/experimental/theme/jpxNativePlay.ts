// TEMPORARY Phase-1 proof hook: on the Android (Capacitor) app, tapping the detail-page Play on a
// Jellyfin/Emby VIDEO opens the NATIVE ExoPlayer instead of the WebView <video> player (which keeps
// breaking). Plex is left on the WebView player. Phase 2 replaces this with a proper jellyfin player
// plugin driven by playbackManager (correct URL resolution, subtitles, resume, progress reporting).
import { ServerConnections } from 'lib/jellyfin-apiclient';

function nativeVideo(): { play: (o: Record<string, unknown>) => unknown } | null {
    const w = window as unknown as { Capacitor?: { Plugins?: { NativeVideo?: { play: (o: Record<string, unknown>) => unknown } } } };
    return (w.Capacitor && w.Capacitor.Plugins && w.Capacitor.Plugins.NativeVideo) || null;
}

document.addEventListener('click', (e: MouseEvent) => {
    const nv = nativeVideo();
    if (!nv) return; // not the native app -> leave everything on the WebView player
    const el = e.target as HTMLElement | null;
    const btn = el && el.closest ? el.closest('.jpx-dh-play') : null;
    if (!btn) return;
    const hash = location.hash || '';
    const idM = hash.match(/[?&]id=([^&]+)/);
    if (!idM) return;
    const itemId = decodeURIComponent(idM[1]);
    if (/_/.test(itemId)) return; // Plex ids look like "<srv>_<key>" -> leave Plex on the WebView player
    const sM = hash.match(/[?&]serverId=([^&]+)/);
    const serverId = sM ? decodeURIComponent(sM[1]) : '';
    type ApiClientLike = { accessToken?(): string; serverAddress?(): string };
    const sc = ServerConnections as unknown as { getApiClient(id: string): unknown; currentApiClient(): unknown };
    let apiClient: ApiClientLike | null = null;
    try {
        apiClient = (serverId ? sc.getApiClient(serverId) : sc.currentApiClient()) as ApiClientLike;
    } catch { return; }
    if (!apiClient || !apiClient.accessToken || !apiClient.serverAddress) return;
    const token = apiClient.accessToken();
    const addr = apiClient.serverAddress();
    if (!token || !addr) return;
    const url = addr + '/Videos/' + itemId + '/stream?static=true&mediaSourceId='
        + encodeURIComponent(itemId) + '&api_key=' + encodeURIComponent(token);
    e.preventDefault();
    e.stopPropagation();
    try { nv.play({ url: url, title: '', startPositionMs: 0 }); } catch { /* ignore */ }
}, true);

export {};
