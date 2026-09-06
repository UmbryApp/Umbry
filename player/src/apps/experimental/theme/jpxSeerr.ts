// Seerr (Jellyseerr / Overseerr) integration. Users link their own request server; Umbry can
// test the connection and open the real Seerr site inside the app — an Electron <webview> in the
// desktop Player (not subject to the site's X-Frame-Options, unlike an iframe), or a new tab in a
// plain browser. Config is stored via jpxPrefs, so it syncs through the Umbry account.

import { getPref, setPref } from './jpxPrefs';

const URL_KEY = 'pref_seerr_url';
const KEY_KEY = 'pref_seerr_key';

export interface SeerrConfig { url: string; key: string; }
export interface SeerrTest { ok: boolean; version?: string; error?: string; }

// Trim, drop trailing slashes, and default to http:// when no scheme is given.
export function normUrl(u: string): string {
    let s = (u || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
}

export function getSeerr(): SeerrConfig {
    return { url: getPref<string>(URL_KEY, ''), key: getPref<string>(KEY_KEY, '') };
}

export function setSeerr(url: string, key: string): void {
    setPref(URL_KEY, normUrl(url));
    setPref(KEY_KEY, (key || '').trim());
}

export function seerrConfigured(): boolean {
    return !!getSeerr().url;
}

interface UmbryBridge { seerrTest?: (url: string, key: string) => Promise<SeerrTest>; }
function umbry(): UmbryBridge | undefined {
    return (window as unknown as { umbry?: UmbryBridge }).umbry;
}

// Test reachability. In the desktop Player we go through the main process (no CORS); in a browser
// we try a direct fetch (works when the server allows CORS, or in the Player's webSecurity-off window).
export async function testSeerr(url: string, key: string): Promise<SeerrTest> {
    const base = normUrl(url);
    if (!base) return { ok: false, error: 'Enter your Seerr address first.' };
    const trimmedKey = (key || '').trim();
    const bridge = umbry();
    if (bridge?.seerrTest) {
        try { return await bridge.seerrTest(base, trimmedKey); } catch (e) { return { ok: false, error: (e as Error).message || 'Test failed.' }; }
    }
    try {
        const init: RequestInit = { headers: trimmedKey ? { 'X-Api-Key': trimmedKey } : {} };
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(6000);
        const res = await fetch(base + '/api/v1/status', init);
        if (!res.ok) return { ok: false, error: 'The server responded with HTTP ' + res.status + '.' };
        const data = await res.json().catch(() => ({})) as { version?: string; commitTag?: string };
        const version = data.version || data.commitTag;
        if (!version) return { ok: false, error: 'That address responded, but it does not look like Jellyseerr or Overseerr.' };
        return { ok: true, version };
    } catch (e) {
        return { ok: false, error: (e as Error).message || 'Could not reach that address.' };
    }
}

// Open the configured Seerr. Desktop -> embedded webview overlay; browser -> new tab.
// Returns false if nothing is configured yet (caller should open the config dialog).
export function openSeerr(): boolean {
    const { url } = getSeerr();
    if (!url) return false;
    if (umbry()) {
        void import('./jpxSeerrView').then(m => m.openSeerrView(url));
    } else {
        try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
    }
    return true;
}
