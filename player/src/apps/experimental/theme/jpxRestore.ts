// Umbry — restore the active session on (re)load so a refresh doesn't bounce out to the
// pre-login server-select / login screen. Called from ConnectionRequired (the connection gate)
// BEFORE it runs its own connect() (which, on reload, clears the stored Jellyfin token in a race).
// Handles a Plex client shim and a Jellyfin/Emby session saved under our own key (jpx-active-jf),
// which Jellyfin's credential manager never touches. Idempotent.

import { ServerConnections } from 'lib/jellyfin-apiclient';
import appSettings from 'scripts/settings/appSettings';
import { appHost } from 'components/apphost';
import { createApiClient } from 'utils/jellyfin-apiclient/createApiClient';

import { makePlexApiClient } from './jpxPlexClient';
import { getPlexServer } from './jpxPlex';
import { applyThemeForCurrentServer } from './jpxTheme';

/* eslint-disable @typescript-eslint/no-explicit-any */

function restorePlex(): boolean {
    try {
        const activeId = localStorage.getItem('jpx-active-plex');
        if (!activeId) return false;
        // Jellyfin/Emby wins when both are marked active: switching TO Plex clears jpx-active-jf
        // synchronously, so a present jf key means this plex key is stale (a switch back to JF that
        // failed to clear it). Drop the stale key and let restoreJellyfin run.
        if (localStorage.getItem('jpx-active-jf')) {
            try { localStorage.removeItem('jpx-active-plex'); } catch { /* ignore */ }
            return false;
        }
        const srv = getPlexServer(activeId);
        if (!srv) return false;
        try { (window as any).LibraryMenu?.setDocumentTitle?.(srv.name); } catch { /* ignore */ }
        const sc = ServerConnections as any;
        const existing = sc.getLocalApiClient && sc.getLocalApiClient();
        if (existing && existing.__plex && existing.serverId && existing.serverId() === srv.id) {
            sc.firstConnection = true;
            return true;
        }
        const client = makePlexApiClient(srv);
        if (!sc._apiClients.some((a: any) => a.serverId && a.serverId() === srv.id)) sc._apiClients.push(client);
        sc.setLocalApiClient(client);
        sc.firstConnection = true;
        return true;
    } catch {
        return false;
    }
}

function restoreJellyfin(): boolean {
    try {
        // Restore when auto-login ("Remember Me") is on, OR when a session is active in THIS window
        // (set by onLoginSuccessful) — so the post-login HARD RELOAD re-arms the session instead of
        // bouncing to the login screen and forcing a second sign-in. sessionStorage clears on app close.
        let jpxSessionActive = false;
        try { jpxSessionActive = !!sessionStorage.getItem('jpx-session-active'); } catch { jpxSessionActive = false; }
        if (!appSettings.enableAutoLogin() && !jpxSessionActive) return false;
        const sc = ServerConnections as any;

        let saved: any = null;
        try { saved = JSON.parse(localStorage.getItem('jpx-active-jf') || 'null'); } catch { saved = null; }

        const cur = sc.getLocalApiClient && sc.getLocalApiClient();
        const curId = cur && cur.serverId && cur.serverId();
        // Keep the current session ONLY if it is already the server we want (or no explicit target).
        // Otherwise fall through and switch the local client to the saved server — else a reload
        // after a Plex->Emby (or Jellyfin<->Emby) switch keeps the previously-current server and its
        // Home shows "no libraries".
        if (cur && cur.isLoggedIn && cur.isLoggedIn() && (!saved || !saved.id || curId === saved.id)) {
            sc.firstConnection = true;
            return true;
        }
        if (!saved || !saved.token || !saved.url || !saved.userId) return false;
        try { (window as any).LibraryMenu?.setDocumentTitle?.(saved.name); } catch { /* ignore */ }

        // Reuse this server's ApiClient if one exists this session; otherwise build one from the
        // saved details (Jellyfin's own credentials were cleared on reload).
        let apiClient: any = null;
        try { apiClient = sc.getApiClient ? sc.getApiClient(saved.id) : null; } catch { apiClient = null; }
        if (!apiClient) {
            apiClient = createApiClient(saved.url, appHost.appName(), appHost.appVersion(), appHost.deviceName(), appHost.deviceId());
            apiClient.enableAutomaticNetworking = false;
            apiClient.manualAddressOnly = true;
            try { apiClient.serverInfo({ Id: saved.id, ManualAddress: saved.url, Name: saved.name || '', AccessToken: saved.token, UserId: saved.userId }); } catch { /* ignore */ }
            // The client was built outside the normal 'apiclientcreated' flow, so wire the few
            // methods that flow adds (else the home crashes on apiClient.subscribe).
            if (typeof apiClient.subscribe !== 'function') apiClient.subscribe = () => { /* no realtime for a restored session */ };
            if (typeof apiClient.getMaxBandwidth !== 'function') apiClient.getMaxBandwidth = () => null;
            if (!sc._apiClients.some((a: any) => a.serverId && a.serverId() === saved.id)) sc._apiClients.push(apiClient);
        }
        apiClient.setAuthenticationInfo(saved.token, saved.userId);
        sc.setLocalApiClient(apiClient);
        sc.firstConnection = true;
        return true;
    } catch {
        return false;
    }
}

export function restorePlexSession(): boolean {
    const plexWon = restorePlex();
    const won = plexWon || restoreJellyfin();
    // The active server is now set (Plex or JF/Emby) — apply that server's own theme. Covers the
    // Plex path, which doesn't fire 'localusersignedin'; JF/Emby also get it via that event.
    if (won) applyThemeForCurrentServer();
    try {
        const sc2 = ServerConnections as any;
        const lc = sc2.getLocalApiClient && sc2.getLocalApiClient();
        let jf: any = null;
        try { jf = JSON.parse(localStorage.getItem('jpx-active-jf') || 'null'); } catch { jf = null; }
        // eslint-disable-next-line no-console
        console.info('[jpx restore]', {
            branch: plexWon ? 'plex' : (won ? 'jellyfin' : 'none'),
            activePlex: localStorage.getItem('jpx-active-plex'),
            jfTarget: jf && { id: jf.id, url: jf.url, user: jf.userId },
            localNow: lc && { addr: lc.serverAddress && lc.serverAddress(), user: lc.getCurrentUserId && lc.getCurrentUserId() }
        });
    } catch { /* ignore */ }
    return won;
}

export default restorePlexSession;
