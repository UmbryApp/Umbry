// Umbry cloud sync — pulls the account's settings blob from the Umbry backend and seeds the
// local stores on sign-in, and pushes (debounced) whenever local app state changes. This REPLACES
// the old jpxSync.ts approach of mirroring into Jellyfin DisplayPreferences: the backend is now the
// single source of truth, localStorage is just a cache.
//
// Owns three blobs, each with a single store: Jellyfin/Emby servers (the stock `jellyfin_credentials`
// credential store), Plex servers (`jpx-plex-servers`), and every pref + parental rule + PIN
// (`jpx-pref-*`). Deliberately reads/writes those stores directly (no imports of jpxPrefs/jpxPlex) to
// avoid an import cycle, since those modules import schedulePush() from here.

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events';

import { apiBase, accountToken, logoutAccount } from './jpxAccount';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PLEX_KEY = 'jpx-plex-servers';
const PREF_PREFIX = 'jpx-pref-';
const JF_CREDS_KEY = 'jellyfin_credentials';
const SERVER_FIELDS = [
    'Id', 'Name', 'ManualAddress', 'LocalAddress', 'RemoteAddress',
    'AccessToken', 'UserId', 'LastConnectionMode'
];

interface Blob {
    jellyfinServers?: any[];
    plexServers?: any[];
    prefs?: Record<string, unknown>;
}

let currentVersion = 0;
let suspend = false;         // true while hydrating, so seeding doesn't trigger a push loop
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function setSuspend(on: boolean): void { suspend = on; }

// ---- credential-store access (Jellyfin/Emby servers live here) ----
function credProvider(): any {
    try {
        const cp = (ServerConnections as any).credentialProvider?.();
        if (cp && typeof cp.credentials === 'function') return cp;
    } catch { /* fall through */ }
    return null;
}
function readJfServers(): any[] {
    const cp = credProvider();
    if (cp) {
        try { return (cp.credentials().Servers || []); } catch { /* fall through */ }
    }
    try { return (JSON.parse(localStorage.getItem(JF_CREDS_KEY) || '{}').Servers || []); } catch { return []; }
}
function writeJfServers(servers: any[]): void {
    const cp = credProvider();
    if (cp) {
        try {
            const creds = cp.credentials();
            creds.Servers = creds.Servers || [];
            for (const s of servers) {
                if (s && s.Id) cp.addOrUpdateServer(creds.Servers, { ...s, DateLastAccessed: Date.now() });
            }
            cp.credentials(creds);
            return;
        } catch { /* fall through to direct write */ }
    }
    try {
        const creds = JSON.parse(localStorage.getItem(JF_CREDS_KEY) || '{}');
        const list = creds.Servers || [];
        for (const s of servers) {
            if (!s || !s.Id) continue;
            const i = list.findIndex((x: any) => x.Id === s.Id);
            if (i >= 0) list[i] = { ...list[i], ...s }; else list.push({ ...s });
        }
        creds.Servers = list;
        localStorage.setItem(JF_CREDS_KEY, JSON.stringify(creds));
    } catch { /* ignore */ }
}
function pick(obj: any, fields: string[]): any {
    const out: any = {};
    for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
    return out;
}

// ---- build a blob from the current local state ----
export function snapshotLocal(): Blob {
    const jellyfinServers = readJfServers()
        .filter((s: any) => s && s.Id && s.AccessToken)   // only real, logged-in servers
        .map((s: any) => pick(s, SERVER_FIELDS));
    let plexServers: any[] = [];
    try { plexServers = JSON.parse(localStorage.getItem(PLEX_KEY) || '[]'); } catch { plexServers = []; }
    const prefs: Record<string, unknown> = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(PREF_PREFIX) === 0) {
                try { prefs[k] = JSON.parse(localStorage.getItem(k) || 'null'); } catch { /* skip */ }
            }
        }
    } catch { /* ignore */ }
    return { jellyfinServers, plexServers, prefs };
}

function blobHasContent(b: Blob | null | undefined): boolean {
    if (!b) return false;
    return !!((b.jellyfinServers && b.jellyfinServers.length)
        || (b.plexServers && b.plexServers.length)
        || (b.prefs && Object.keys(b.prefs).length));
}

// ---- seed the local stores from a blob (server wins) ----
export async function hydrateFromBlob(blob: Blob): Promise<void> {
    setSuspend(true);
    try {
        if (Array.isArray(blob.jellyfinServers) && blob.jellyfinServers.length) writeJfServers(blob.jellyfinServers);
        if (Array.isArray(blob.plexServers)) {
            try { localStorage.setItem(PLEX_KEY, JSON.stringify(blob.plexServers)); } catch { /* ignore */ }
        }
        if (blob.prefs && typeof blob.prefs === 'object') {
            for (const [k, v] of Object.entries(blob.prefs)) {
                if (k.indexOf(PREF_PREFIX) === 0) {
                    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
                }
            }
        }
        // Re-apply pref side effects (body classes / CSS vars) now that localStorage holds them.
        try { (await import('./jpxPrefs')).initJpxPrefs?.(); } catch { /* ignore */ }
        try { document.dispatchEvent(new CustomEvent('jpx-plex-servers-changed')); } catch { /* ignore */ }
    } finally {
        setSuspend(false);
    }
}

function mergeBlobs(server: Blob, local: Blob): Blob {
    const byId = (a: any[] = [], b: any[] = [], key: string) => {
        const map = new Map<string, any>();
        for (const x of a) if (x && x[key]) map.set(String(x[key]), x);
        for (const x of b) if (x && x[key]) map.set(String(x[key]), { ...map.get(String(x[key])), ...x });
        return Array.from(map.values());
    };
    return {
        jellyfinServers: byId(server.jellyfinServers, local.jellyfinServers, 'Id'),
        plexServers: byId(server.plexServers, local.plexServers, 'id'),
        prefs: { ...(server.prefs || {}), ...(local.prefs || {}) }
    };
}

// ---- push local state to the backend (debounced entrypoint = schedulePush) ----
export async function pushNow(blob?: Blob): Promise<void> {
    const tok = accountToken();
    if (!tok) return;
    let body = blob || snapshotLocal();
    try {
        let res = await fetch(`${apiBase()}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ blob: body, version: currentVersion })
        });
        if (res.status === 401) { logoutAccount(); return; }
        if (res.status === 409) {
            const srv = await res.json().catch(() => ({}));
            currentVersion = srv.version || currentVersion;
            body = mergeBlobs(srv.blob || {}, body);
            res = await fetch(`${apiBase()}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
                body: JSON.stringify({ blob: body, version: currentVersion })
            });
        }
        if (res.ok) {
            const d = await res.json().catch(() => ({}));
            if (typeof d.version === 'number') currentVersion = d.version;
        }
    } catch { /* offline — will push again on the next change */ }
}

export function schedulePush(): void {
    if (suspend || !accountToken()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; void pushNow(); }, 1200);
}

// ---- pull on sign-in / boot; seed the account from local on first use ----
export async function pullAndHydrate(): Promise<void> {
    const tok = accountToken();
    if (!tok) return;
    const res = await fetch(`${apiBase()}/settings`, { headers: { Authorization: `Bearer ${tok}` } });
    if (res.status === 401) { logoutAccount(); throw new Error('session expired'); }
    if (!res.ok) throw new Error(`settings fetch failed (${res.status})`);
    const data = await res.json().catch(() => ({ blob: {}, version: 0 }));
    currentVersion = data.version || 0;
    if (blobHasContent(data.blob)) {
        await hydrateFromBlob(data.blob);
        // hydrate ADDS the blob's servers but never removes local ones, so the post-hydrate snapshot =
        // blob ∪ local-only servers. Push it, so servers that exist only on this device (e.g. Jellyfin/
        // Emby added before this account existed) are saved to the account and persist across devices.
        try {
            const merged = snapshotLocal();
            if (blobHasContent(merged)) await pushNow(merged);
        } catch { /* ignore */ }
    } else {
        // Account is empty — seed it from whatever is on this device (first-device migration).
        const local = snapshotLocal();
        if (blobHasContent(local)) await pushNow(local);
    }
}

// Push when a Jellyfin/Emby server is signed into or out of (credential changes don't flow through
// setPref/savePlexServers). snapshotLocal() re-reads the credential store, so the new/removed server
// is captured. Called once from AppLayout.
export function initJpxCloud(): void {
    try {
        Events.on(ServerConnections, 'localusersignedin', () => schedulePush());
        Events.on(ServerConnections, 'localusersignedout', () => schedulePush());
    } catch { /* ignore */ }
}

// exposed for the account gate to call as a global (mirrors window.__jpxRestorePlex)
try { (window as any).__jpxAccountHydrate = pullAndHydrate; } catch { /* ignore */ }
