// Umbry Kids Mode deep-link guard. Restricted items are handled in lists (hidden, or kept and
// PIN-gated), but a direct URL/hash to an item's detail page (#/details?id=…) needs its own check.
// While Kids Mode is active this watches the route and, for the target item:
//   - in a hidden/auto-hidden library (self or ancestor) -> always redirect Home (no PIN bypass).
//   - blocked by rating/genre in "hide" mode -> redirect Home.
//   - blocked by rating/genre in "lock" mode -> prompt for the PIN; correct unlocks it for this
//     session, cancel/wrong redirects Home.
// The main view is blanked during the check so restricted art/titles never flash before a redirect.

import { ServerConnections } from 'lib/jellyfin-apiclient';

import { kidsModeActive, isContentBlocked, isHiddenLibraryItem, isLibraryHidden, restrictionMode, hasPin } from './jpxParental';
import { promptPin } from './jpxPinPrompt';
import './jpxParental.scss';

const PENDING = 'jpx-guard-pending';
let seq = 0;
const unlocked = new Set<string>(); // items the user PIN-unlocked this session (lock mode)

function setPending(on: boolean): void {
    try { document.body.classList.toggle(PENDING, on); } catch { /* ignore */ }
}
function toast(msg: string): void {
    import('components/toast/toast')
        .then(m => { try { (m.default as (o: unknown) => void)(msg); } catch { /* ignore */ } })
        .catch(() => { /* best-effort */ });
}
function goHome(): void {
    try { window.location.hash = '#/home'; } catch { /* ignore */ }
}

function detailIdFromHash(): string | null {
    const h = String(window.location.hash || '');
    const q = h.indexOf('?');
    if (q < 0) return null;
    const route = h.slice(0, q).replace(/^#!?\/?/, '').toLowerCase();
    if (route !== 'details') return null;
    try { return new URLSearchParams(h.slice(q + 1)).get('id'); } catch { return null; }
}

async function checkRoute(): Promise<void> {
    if (!kidsModeActive()) { setPending(false); return; }
    const id = detailIdFromHash();
    if (!id) { setPending(false); return; }
    if (unlocked.has(id)) { setPending(false); return; }

    const myHash = window.location.hash;
    const mySeq = ++seq;
    setPending(true);
    const stillHere = () => mySeq === seq && window.location.hash === myHash;

    try {
        const apiClient = ServerConnections.currentApiClient() as {
            getItem: (u: string, id: string) => Promise<Record<string, unknown>>;
            getCurrentUserId: () => string;
            getAncestorItems?: (id: string, u: string) => Promise<Array<Record<string, unknown>>>;
        } | undefined;
        if (!apiClient || typeof apiClient.getItem !== 'function') { if (stillHere()) { setPending(false); toast('Restricted in Kids Mode'); goHome(); } return; }
        const userId = apiClient.getCurrentUserId();
        const item = await apiClient.getItem(userId, id);

        // Hidden library (self or ancestor) -> always blocked, never PIN-bypassable.
        let hidden = isHiddenLibraryItem(item);
        if (!hidden && typeof apiClient.getAncestorItems === 'function') {
            try {
                const ancestors = await apiClient.getAncestorItems(id, userId);
                if (Array.isArray(ancestors) && ancestors.some(a => isLibraryHidden(a.Id))) hidden = true;
            } catch { /* ancestors unavailable */ }
        }
        if (!stillHere()) return;
        if (hidden) { setPending(false); toast('Restricted in Kids Mode'); goHome(); return; }

        // Content blocked (rating / genre / tag)?
        if (isContentBlocked(item)) {
            if (restrictionMode() === 'lock') {
                setPending(false); // reveal so the PIN pad sits over the page
                const ok = hasPin()
                    ? await promptPin({ mode: 'verify', title: 'Restricted', subtitle: 'Enter your PIN to watch this' })
                    : true;
                if (ok) { unlocked.add(id); return; }
                if (stillHere()) goHome();
                return;
            }
            setPending(false); toast('Restricted in Kids Mode'); goHome();
            return;
        }

        setPending(false); // allowed
    } catch {
        if (stillHere()) { setPending(false); toast('Restricted in Kids Mode'); goHome(); }
    }
}

let started = false;
export function initDeepLinkGuard(): void {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', () => { void checkRoute(); });
    window.addEventListener('jpx-kids-mode-changed', () => { unlocked.clear(); void checkRoute(); });
    void checkRoute();
}
