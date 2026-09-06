// Umbry — Per-server library inclusion picker (first-run + settings). Lists the CURRENT server's
// libraries with checkboxes (all checked by default, or from the saved selection) and, on confirm,
// saves which libraries are included in Umbry for that server. Deselected libraries are excluded
// app-wide by jpxLibraryInclusion's getUserViews filters.
//
// Mirrors the imperative createRoot + Promise shell of jpxHomeLibrariesPrompt / jpxPinPrompt and
// reuses jpxPinPrompt.scss. Themed with var(--jpx-t-accent, #9385F5).
//
// initJpxLibrarySelection() installs the filters and, on home/app init, prompts ONCE for any server
// that has no saved selection yet (re-checking on server switch). The picker fetches libraries
// inside withRawViews() so it always sees the FULL list even though the app-wide filter is active.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import {
    activeServerId, hasSelectionFor, includedLibraryIds, serverKeyForClient, setIncludedLibraryIds,
    installLibraryInclusion, refreshLibraryViews, withRawViews
} from './jpxLibraryInclusion';
import './jpxPinPrompt.scss';

interface Lib { Id: string; Name: string; CollectionType?: string }

const ACCENT = 'var(--jpx-t-accent, #9385F5)';

function iconFor(t?: string): string {
    switch (t) {
        case 'movies': return 'movie';
        case 'tvshows': return 'live_tv';
        case 'music': return 'library_music';
        case 'books': return 'menu_book';
        case 'homevideos': case 'photos': return 'photo_library';
        case 'musicvideos': return 'music_video';
        case 'boxsets': return 'video_library';
        case 'livetv': return 'dvr';
        default: return 'folder';
    }
}

function LibrarySelection({ onDone }: { onDone: () => void }) {
    const [ libs, setLibs ] = useState<Lib[] | null>(null);
    const [ checked, setChecked ] = useState<Set<string>>(new Set());
    const [ error, setError ] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const apiClient = ServerConnections.currentApiClient() as {
                    getUserViews: (o: unknown, u: string) => Promise<{ Items?: Lib[] }>;
                    getCurrentUserId: () => string;
                } | undefined;
                if (!apiClient) { setError('No server connected'); setLibs([]); return; }
                // Fetch the FULL list (bypass the inclusion filter) so excluded libraries can be re-added.
                const res = await withRawViews(() => apiClient.getUserViews({}, apiClient.getCurrentUserId()));
                const items = (res?.Items || []) as Lib[];
                setLibs(items);
                // Initial checked state: saved selection, or ALL when none saved (null == all).
                // Key by THIS apiClient (same key the filter uses) — activeServerId() is Plex-first and
                // would mis-key a Jellyfin/Emby picker under the Plex key while a Plex session is active.
                const saved = includedLibraryIds(serverKeyForClient(apiClient));
                if (saved === null) {
                    setChecked(new Set(items.map(l => String(l.Id))));
                } else {
                    setChecked(new Set(saved));
                }
            } catch {
                setError('Could not load libraries');
                setLibs([]);
            }
        })();
    }, []);

    const toggle = (id: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Persist + close. Store [] (== all) when every library is checked, so future libraries are
    // auto-included and we never accidentally hide everything; otherwise store the checked subset.
    const commit = () => {
        try {
            const all = libs || [];
            const ids = all.map(l => String(l.Id)).filter(id => checked.has(id));
            const value = (all.length > 0 && ids.length === all.length) ? [] : ids;
            // Save under the SAME per-client key the filter reads (not Plex-first activeServerId()).
            setIncludedLibraryIds(serverKeyForClient(ServerConnections.currentApiClient()), value);
            refreshLibraryViews();
        } catch { /* ignore */ }
        onDone();
    };

    const primaryBtn: React.CSSProperties = {
        marginTop: '0.9em', width: '100%', padding: '0.7em 1em', borderRadius: '0.6em',
        border: 0, cursor: 'pointer', fontSize: '0.98rem', fontWeight: 600,
        color: '#fff', background: ACCENT
    };

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) commit(); }}>
            <div className='jpx-pin-card jpx-pin-card-wide' role='dialog' aria-modal='true' aria-label='Choose Libraries'>
                <div className='jpx-pin-lock material-icons' aria-hidden='true' style={{ color: ACCENT }}>video_library</div>
                <div className='jpx-pin-title'>Choose Libraries</div>
                <div className='jpx-pin-sub'>Pick which of this server&rsquo;s libraries appear in Umbry. Unchecked libraries are hidden everywhere in the app. You can change this anytime in Settings.</div>
                <div className='jpx-lib-list'>
                    {libs === null ? <div className='jpx-lib-empty'>Loading&hellip;</div>
                        : error ? <div className='jpx-lib-empty'>{error}</div>
                            : libs.length === 0 ? <div className='jpx-lib-empty'>No libraries found</div>
                                : libs.map(l => {
                                    const on = checked.has(String(l.Id));
                                    return (
                                        <button key={l.Id} type='button' className='jpx-lib-row' onClick={() => toggle(String(l.Id))}>
                                            <span className='material-icons jpx-lib-ic' aria-hidden='true'>{iconFor(l.CollectionType)}</span>
                                            <span className='jpx-lib-name'>{l.Name}</span>
                                            <span className='material-icons jpx-lib-check' aria-hidden='true' style={on ? { color: ACCENT, opacity: 1 } : undefined}>
                                                {on ? 'check_box' : 'check_box_outline_blank'}
                                            </span>
                                        </button>
                                    );
                                })}
                </div>
                <button type='button' style={primaryBtn} onClick={commit}>Continue</button>
            </div>
        </div>
    );
}

export function promptLibrarySelection(): Promise<void> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = () => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve();
        };
        root.render(<LibrarySelection onDone={done} />);
    });
}

// ---- First-run hook ----
let inited = false;
const inFlight = new Set<string>();

async function maybePrompt(): Promise<void> {
    try {
        const ac = ServerConnections.currentApiClient?.() as {
            getUserViews: (o: unknown, u: string) => Promise<{ Items?: unknown[] }>;
            getCurrentUserId: () => string;
        } | undefined;
        if (!ac || typeof ac.getCurrentUserId !== 'function') return;
        // Key by the CURRENT apiClient (matches the filter) — activeServerId() is Plex-first and would
        // fire the Plex picker while switching to a Jellyfin/Emby server whose session isn't active yet.
        const sid = serverKeyForClient(ac);
        if (sid === 'default') return;              // no server resolved yet
        if (hasSelectionFor(sid)) return;           // already chosen for this server
        if (inFlight.has(sid)) return;              // modal already open for it
        // Only prompt once the server actually has libraries (avoids an empty pre-login prompt).
        const res = await withRawViews(() => ac.getUserViews({}, ac.getCurrentUserId()));
        const items = (res?.Items || []) as unknown[];
        if (!items.length) return;
        // Re-check after the await (server may have switched, or a selection just saved).
        if (serverKeyForClient(ServerConnections.currentApiClient()) !== sid || hasSelectionFor(sid) || inFlight.has(sid)) return;
        inFlight.add(sid);
        try { await promptLibrarySelection(); } finally { inFlight.delete(sid); }
    } catch { /* ignore */ }
}

export function initJpxLibrarySelection(): void {
    if (inited) return;
    inited = true;
    installLibraryInclusion();
    // Poll (server + views become ready asynchronously after login) and re-check on route changes,
    // so a server switch to a not-yet-chosen server also prompts once.
    setInterval(() => { void maybePrompt(); }, 2000);
    window.addEventListener('hashchange', () => { void maybePrompt(); });
    void maybePrompt();
}

export default initJpxLibrarySelection;
