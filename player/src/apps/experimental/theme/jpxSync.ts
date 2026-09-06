// Umbry cross-device sync. The Plex server list and all `jpx-pref-*` settings live in
// localStorage (fast, per-device). To make them follow the user across devices we mirror them
// into the logged-in Jellyfin user's server-side DisplayPreferences CustomPrefs (userSettings),
// which Jellyfin syncs per-user everywhere. On Jellyfin login we hydrate: merge the server copy
// with whatever is local (union), write the union back to both. Push-on-change happens in
// jpxPrefs.setPref and jpxPlex.savePlexServers. A subtle toast + a "Sync now" control surface it.

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events';
import { currentSettings, set as setUserSetting } from 'scripts/settings/userSettings';

import { getPlexServers } from './jpxPlex';
import { initJpxPrefs } from './jpxPrefs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PLEX_KEY = 'jpx-plex-servers';
const PREF_PREFIX = 'jpx-pref-';

let lastSyncAt = 0;

function customPrefs(): Record<string, string> | null {
    const dp = (currentSettings as any)?.displayPrefs;
    return dp && dp.CustomPrefs ? dp.CustomPrefs : null;
}

// Self-contained toast (no React / no new stylesheet) so it works from anywhere.
function showSyncToast(text: string, warn?: boolean): void {
    try {
        let el = document.querySelector('.jpx-sync-toast') as any;
        if (!el) {
            el = document.createElement('div');
            el.className = 'jpx-sync-toast';
            el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);z-index:100000;padding:10px 18px 10px 14px;border-radius:999px;font:500 14px/1.15 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);opacity:0;transition:opacity .28s ease,transform .28s ease;pointer-events:none;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;gap:8px;color:#fff;max-width:80vw';
            document.body.appendChild(el);
        }
        el.style.background = warn ? 'rgba(120,72,20,.96)' : 'rgba(22,22,30,.96)';
        el.innerHTML = '<span class="material-icons" style="font-size:18px;color:' + (warn ? '#ffcf70' : '#6ee7b7') + '">' + (warn ? 'cloud_off' : 'cloud_done') + '</span><span class="jpx-sync-toast-t"></span>';
        (el.querySelector('.jpx-sync-toast-t') as HTMLElement).textContent = text;
        requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
        clearTimeout(el.__t);
        el.__t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(12px)'; }, 2600);
    } catch { /* ignore */ }
}

// The actual union/merge. Returns true if it ran (Jellyfin prefs were available).
function doMerge(cp: Record<string, string>): boolean {
    // ---- Plex servers: union by id, server + local, write to both ----
    let serverList: any[] = [];
    try { serverList = cp[PLEX_KEY] ? JSON.parse(cp[PLEX_KEY]) : []; } catch { serverList = []; }
    const byId: Record<string, any> = {};
    [ ...serverList, ...getPlexServers() ].forEach(s => { if (s && s.id) byId[s.id] = { ...byId[s.id], ...s }; });
    const merged = Object.values(byId);
    const mergedJson = JSON.stringify(merged);
    try { localStorage.setItem(PLEX_KEY, mergedJson); } catch { /* private mode */ }
    if (mergedJson !== (cp[PLEX_KEY] || '')) {
        try { setUserSetting(PLEX_KEY, mergedJson); } catch { /* ignore */ }
    }

    // ---- Prefs: server jpx-pref-* -> localStorage (server wins) ----
    Object.keys(cp).forEach(k => {
        if (k.indexOf(PREF_PREFIX) === 0 && cp[k] != null) {
            try { localStorage.setItem(k, String(cp[k])); } catch { /* ignore */ }
        }
    });
    // Push any local-only jpx-pref-* up so a device's earlier tweaks propagate.
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(PREF_PREFIX) === 0 && cp[k] == null) {
                setUserSetting(k, String(localStorage.getItem(k)));
            }
        }
    } catch { /* ignore */ }

    initJpxPrefs();
    lastSyncAt = Date.now();
    try { Events.trigger(document, 'jpx-plex-servers-changed'); } catch { /* ignore */ }
    return true;
}

/** Merge server <-> local. Retries until the Jellyfin user's DisplayPreferences have loaded.
 * `toast` shows a confirmation when the merge runs (used for real logins, not silent mount hydrates). */
export function hydrateJpx(attempt = 0, toast = false): void {
    // RETIRED: the Umbry backend (jpxCloud) is the source of truth for servers + settings now.
    // The old Jellyfin DisplayPreferences merge is disabled so the two sync systems don't fight
    // (e.g. a stale DisplayPrefs copy clobbering the backend-hydrated state on Jellyfin sign-in).
    void attempt; void toast;
}

/** Manual "Sync now". Resolves to whether the sync ran (false if not signed into Jellyfin). */
export function syncNow(): Promise<boolean> {
    // Manual "Sync now" now pushes the current local state up to the Umbry backend.
    return import('./jpxCloud').then(async (m) => {
        if (!localStorage.getItem('jpx-account-token')) {
            showSyncToast('Sign in to your Umbry account to sync', true);
            return false;
        }
        await m.pushNow();
        showSyncToast('Servers & settings synced across your devices');
        return true;
    }).catch(() => { showSyncToast('Sync failed — try again', true); return false; });
}

export function getLastSyncAt(): number { return lastSyncAt; }

let inited = false;
/** Subscribe once: hydrate whenever a real Jellyfin user signs in (not the Plex shim user). */
export function initJpxSync(): void {
    if (inited) return;
    inited = true;
    try {
        Events.on(ServerConnections, 'localusersignedin', (_e: unknown, user: any) => {
            if (user && user.Id && user.Id !== 'plexuser') {
                hydrateJpx(0, true);
                // Persist the Jellyfin session under our own key so a refresh can re-arm it
                // (Jellyfin clears its own stored token on reload).
                try {
                    // Use the apiClient that just signed THIS user in — NOT currentApiClient(), which can
                    // still point at the previously-active server when this event fires. That mismatch
                    // saved the wrong server under jpx-active-jf, so logging into one server (e.g. Jellyfin)
                    // handed you the other server's home (e.g. Emby), and it persisted across restarts.
                    const clients = ((ServerConnections as any)._apiClients || []);
                    let ac: any = null;
                    try { if (user.ServerId && (ServerConnections as any).getApiClient) ac = (ServerConnections as any).getApiClient(user.ServerId); } catch { /* ignore */ }
                    if (!ac || !ac.accessToken || !ac.accessToken()) {
                        ac = clients.find((c: any) => {
                            try { return c && !c.__plex && c.getCurrentUserId && c.getCurrentUserId() === user.Id && c.accessToken && c.accessToken(); } catch { return false; }
                        }) || ServerConnections.currentApiClient();
                    }
                    if (ac && !ac.__plex && ac.accessToken && ac.accessToken()) {
                        localStorage.setItem('jpx-active-jf', JSON.stringify({
                            id: ac.serverId(), url: ac.serverAddress(), userId: ac.getCurrentUserId(),
                            token: ac.accessToken(), name: (ac.serverInfo && ac.serverInfo().Name) || ''
                        }));
                        localStorage.removeItem('jpx-active-plex');
                    }
                } catch { /* ignore */ }
            }
        });
        Events.on(ServerConnections, 'localusersignedout', () => {
            try { localStorage.removeItem('jpx-active-jf'); localStorage.removeItem('jpx-active-plex'); } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
    hydrateJpx();
}

export default initJpxSync;
