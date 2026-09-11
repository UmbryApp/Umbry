/* eslint-disable @typescript-eslint/no-explicit-any */
// Umbry offline downloads — cross-platform engine.
//
// On the native Android app it delegates to the native UmbryDownload Capacitor plugin (downloads the
// file to app storage, played by the native ExoPlayer). On web / PWA / Electron it fetches the item's
// direct-play file and stores it in the Cache Storage API, played back offline from a blob URL.
// A manifest in localStorage tracks every download so the Downloads library and the detail-page
// button state survive reloads and work with no server connection.
import { ServerConnections } from 'lib/jellyfin-apiclient';

export interface DlEntry {
    id: string;          // storage key: `${serverId}_${itemId}`
    itemId: string;
    serverId: string;
    name: string;
    type: string;        // Movie / Episode / Audio / MusicVideo
    mediaType: string;   // Video / Audio
    poster: string;
    seriesName?: string;
    runTimeTicks?: number;
    size: number;        // bytes (0 until done)
    when: number;
    status: 'downloading' | 'done' | 'error';
    pct: number;
    error?: string;
}

const KEY = 'jpx-downloads';
const CACHE = 'umbry-downloads-v1';
const listeners = new Set<(e: DlEntry[]) => void>();

export function getDownloads(): DlEntry[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function saveAll(list: DlEntry[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } emit(list); }
function emit(list: DlEntry[]) { for (const fn of Array.from(listeners)) { try { fn(list); } catch { /* ignore */ } } }
export function onDownloadsChanged(fn: (e: DlEntry[]) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getEntry(id: string): DlEntry | undefined { return getDownloads().find(e => e.id === id); }
export function entryId(item: any): string { return (item.ServerId || 'srv') + '_' + item.Id; }
function upsert(entry: DlEntry) { const list = getDownloads().filter(e => e.id !== entry.id); list.unshift(entry); saveAll(list); }
function patch(id: string, p: Partial<DlEntry>) { const list = getDownloads(); const i = list.findIndex(e => e.id === id); if (i >= 0) { list[i] = { ...list[i], ...p }; saveAll(list); } }

function nativePlugin(): any {
    const w = window as any;
    if (!w.Capacitor) return null;
    if (w.Capacitor.Plugins && w.Capacitor.Plugins.UmbryDownload) return w.Capacitor.Plugins.UmbryDownload;
    if (typeof w.Capacitor.registerPlugin === 'function') { try { return w.Capacitor.registerPlugin('UmbryDownload'); } catch { return null; } }
    return null;
}
export function isNativeDownloads(): boolean { return !!nativePlugin(); }

// Listen once to native download progress events and reflect them on the entry (the Downloads
// grid + detail button already render `pct`).
let _progressWired = false;
function wireNativeProgress() {
    if (_progressWired) return;
    const np = nativePlugin();
    if (np && typeof np.addListener === 'function') {
        try { np.addListener('progress', (e: any) => { if (e && e.id != null) patch(String(e.id), { pct: Math.max(0, Math.min(99, Number(e.pct) || 0)) }); }); _progressWired = true; } catch { /* ignore */ }
    }
}

function apiFor(serverId: string): any {
    const sc = ServerConnections as any;
    try { return serverId ? sc.getApiClient(serverId) : sc.currentApiClient(); } catch { return null; }
}

// The direct-play file URL for a leaf item (static=true = the original file, no transcode).
// The universal download endpoint (video AND audio, Jellyfin AND Emby) is /Items/{id}/Download.
// It needs the MediaBrowser auth HEADER (a query api_key alone 401s / a stream URL can 400 on Emby),
// so downloads send authHeader() rather than putting the token in the URL.
export function sourceUrl(item: any, apiClient: any): string {
    if (item && item.__streamUrl) { const u = String(item.__streamUrl); return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'download=1'; }
    return apiClient.serverAddress() + '/Items/' + item.Id + '/Download';
}
export function authHeader(apiClient: any): string { try { if (apiClient && apiClient.__plex) return ''; return 'MediaBrowser Token="' + apiClient.accessToken() + '"'; } catch { return ''; } }

// Only DRM-free leaf items on Jellyfin/Emby (Plex ids look like "<srv>_<key>" and use a separate API).
export function isDownloadable(item: any): boolean {
    if (!item) return false;
    const t = item.Type; const mt = item.MediaType;
    const leaf = (mt === 'Video' || mt === 'Audio') && (t === 'Movie' || t === 'Episode' || t === 'Audio' || t === 'MusicVideo' || t === 'Video');
    if (/_/.test(String(item.Id || ''))) return leaf && !!item.__streamUrl;   // Plex: needs a resolved direct part URL
    return leaf;
}

function posterUrl(item: any, apiClient: any): string {
    try {
        const tag = item.ImageTags && item.ImageTags.Primary;
        if (tag) return apiClient.getImageUrl(item.Id, { type: 'Primary', tag, maxHeight: 400 });
        if (item.SeriesId && item.SeriesPrimaryImageTag) return apiClient.getImageUrl(item.SeriesId, { type: 'Primary', tag: item.SeriesPrimaryImageTag, maxHeight: 400 });
    } catch { /* ignore */ }
    return '';
}

function cacheKey(id: string): string { return '/__umbry_dl__/' + encodeURIComponent(id); }

// ---- web (Cache Storage) backend ----
async function webDownload(entry: DlEntry, url: string, auth?: string) {
    const res = await fetch(url, auth ? { headers: { Authorization: auth } } : undefined);
    if (!res.ok || !res.body) throw new Error('fetch failed ' + res.status);
    const total = Number(res.headers.get('Content-Length') || '0');
    const reader = res.body.getReader();
    const chunks: BlobPart[] = []; let received = 0; let lastPct = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value); received += value.length;
            if (total) { const pct = Math.min(99, Math.round(received / total * 100)); if (pct !== lastPct) { lastPct = pct; patch(entry.id, { pct }); } }
        }
    }
    const blob = new Blob(chunks, { type: res.headers.get('Content-Type') || 'video/mp4' });
    const cache = await caches.open(CACHE);
    await cache.put(cacheKey(entry.id), new Response(blob));
    patch(entry.id, { status: 'done', pct: 100, size: blob.size || received });
}

export async function localPlayUrl(id: string): Promise<string> {
    const np = nativePlugin();
    if (np && np.getPath) { try { const r = await np.getPath({ id }); return (r && r.path) ? r.path : ''; } catch { return ''; } }
    try { const cache = await caches.open(CACHE); const res = await cache.match(cacheKey(id)); if (res) { const blob = await res.blob(); return URL.createObjectURL(blob); } } catch { /* ignore */ }
    return '';
}

export async function removeDownload(id: string): Promise<void> {
    const np = nativePlugin();
    if (np && np.remove) { try { await np.remove({ id }); } catch { /* ignore */ } }
    try { const cache = await caches.open(CACHE); await cache.delete(cacheKey(id)); } catch { /* ignore */ }
    saveAll(getDownloads().filter(e => e.id !== id));
}

export async function startDownload(item: any, apiClientArg?: any): Promise<void> {
    const apiClient = apiClientArg || apiFor(item.ServerId || '');
    if (!apiClient || !apiClient.serverAddress) throw new Error('no server');
    const id = entryId(item);
    const existing = getEntry(id);
    if (existing && existing.status === 'done') return;
    const entry: DlEntry = {
        id, itemId: item.Id, serverId: item.ServerId || '', name: item.Name || 'Untitled',
        type: item.Type || '', mediaType: item.MediaType || 'Video', poster: posterUrl(item, apiClient),
        seriesName: item.SeriesName, runTimeTicks: item.RunTimeTicks, size: 0, when: Date.now(), status: 'downloading', pct: 0
    };
    upsert(entry);
    const url = sourceUrl(item, apiClient);
    const auth = authHeader(apiClient);
    wireNativeProgress();
    const errMsg = (e: any) => String(e && e.message ? e.message : e).slice(0, 160);
    try {
        // Prefer the native downloader (bypasses WebView mixed-content/CORS). If it isn't really
        // available or errors, fall back to the web (Cache Storage) path so a failure isn't silent.
        const np = nativePlugin();
        let nativeErr = '';
        if (np && np.start) {
            try { await np.start({ id, url, title: entry.name, auth }); patch(id, { status: 'done', pct: 100, error: undefined }); return; }
            catch (ne) { nativeErr = errMsg(ne); }
        }
        try { await webDownload(entry, url, auth); }
        catch (we) { patch(id, { status: 'error', error: (nativeErr ? 'native: ' + nativeErr + ' | ' : '') + 'web: ' + errMsg(we) }); return; }
    } catch (e) { patch(id, { status: 'error', error: errMsg(e) }); }
}

// expose for the detail-page button (a plain .js module) and for verification
try { (window as any).jpxDownloads = { startDownload, removeDownload, getDownloads, getEntry, entryId, isDownloadable, onDownloadsChanged, localPlayUrl, isNativeDownloads }; } catch { /* ignore */ }
