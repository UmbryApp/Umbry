// Imperative picker for Home-screen library visibility + order. Lists the current server's
// libraries (in the saved Home order, hidden ones included and marked), with an eye toggle to
// show/hide each on Home and up/down arrows to reorder. Writes to the HOME_* prefs (synced).
// Mirrors jpxLibrarySelect's shell/CSS. Resolves when closed.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import {
    getHiddenHomeLibs, setHiddenHomeLibs,
    getHomeLibOrder, setHomeLibOrder
} from './jpxHomeLibraries';
import './jpxPinPrompt.scss';

interface Lib { Id: string; Name: string; CollectionType?: string }

function iconFor(t?: string): string {
    switch (t) {
        case 'movies': return 'movie';
        case 'tvshows': return 'live_tv';
        case 'music': return 'library_music';
        case 'books': return 'menu_book';
        case 'homevideos': case 'photos': return 'photo_library';
        case 'musicvideos': return 'music_video';
        case 'boxsets': return 'video_library';
        default: return 'folder';
    }
}

// Order `libs` by the saved Home order (unknown ones appended in their original order).
function orderLibs(libs: Lib[], order: string[]): Lib[] {
    if (!order.length) return libs;
    const pos = new Map(order.map((id, i) => [ id, i ]));
    const known = libs.filter(l => pos.has(String(l.Id))).sort((a, b) => (pos.get(String(a.Id)) ?? 0) - (pos.get(String(b.Id)) ?? 0));
    const unknown = libs.filter(l => !pos.has(String(l.Id)));
    return [ ...known, ...unknown ];
}

function HomeLibraries({ onDone }: { onDone: () => void }) {
    const [ libs, setLibs ] = useState<Lib[] | null>(null);
    const [ hidden, setHidden ] = useState<string[]>(() => getHiddenHomeLibs());
    const [ error, setError ] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const apiClient = ServerConnections.currentApiClient() as {
                    getUserViews: (o: unknown, u: string) => Promise<{ Items?: Lib[] }>;
                    getCurrentUserId: () => string;
                } | undefined;
                if (!apiClient) { setError('No server connected'); setLibs([]); return; }
                const res = await apiClient.getUserViews({}, apiClient.getCurrentUserId());
                setLibs(orderLibs((res?.Items || []) as Lib[], getHomeLibOrder()));
            } catch {
                setError('Could not load libraries');
                setLibs([]);
            }
        })();
    }, []);

    const persistOrder = (list: Lib[]) => setHomeLibOrder(list.map(l => String(l.Id)));

    const move = (idx: number, delta: number) => {
        setLibs(prev => {
            if (!prev) return prev;
            const j = idx + delta;
            if (j < 0 || j >= prev.length) return prev;
            const next = prev.slice();
            const tmp = next[idx]; next[idx] = next[j]; next[j] = tmp;
            persistOrder(next);
            return next;
        });
    };

    const toggle = (id: string) => {
        setHidden(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [ ...prev, id ];
            setHiddenHomeLibs(next);
            return next;
        });
    };

    const btn: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer',
        padding: '0.35em', borderRadius: '0.4em', opacity: 0.85
    };

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onDone(); }}>
            <div className='jpx-pin-card jpx-pin-card-wide' role='dialog' aria-modal='true' aria-label='Homepage Libraries'>
                <div className='jpx-pin-lock material-icons' aria-hidden='true'>video_library</div>
                <div className='jpx-pin-title'>Homepage Libraries</div>
                <div className='jpx-pin-sub'>Show, hide, and reorder the libraries on your Home screen. This only affects Home — libraries stay reachable everywhere else.</div>
                <div className='jpx-lib-list'>
                    {libs === null ? <div className='jpx-lib-empty'>Loading…</div>
                        : error ? <div className='jpx-lib-empty'>{error}</div>
                            : libs.length === 0 ? <div className='jpx-lib-empty'>No libraries found</div>
                                : libs.map((l, i) => {
                                    const off = hidden.includes(String(l.Id));
                                    return (
                                        <div key={l.Id} className={`jpx-lib-row${off ? ' hidden-on' : ''}`} style={{ opacity: off ? 0.55 : 1 }}>
                                            <span style={{ display: 'inline-flex', flexDirection: 'column', marginRight: '0.25em' }}>
                                                <button type='button' aria-label='Move up' style={{ ...btn, opacity: i === 0 ? 0.25 : 0.85 }} disabled={i === 0} onClick={() => move(i, -1)}>
                                                    <span className='material-icons' aria-hidden='true' style={{ fontSize: '1.15em' }}>keyboard_arrow_up</span>
                                                </button>
                                                <button type='button' aria-label='Move down' style={{ ...btn, opacity: i === libs.length - 1 ? 0.25 : 0.85 }} disabled={i === libs.length - 1} onClick={() => move(i, 1)}>
                                                    <span className='material-icons' aria-hidden='true' style={{ fontSize: '1.15em' }}>keyboard_arrow_down</span>
                                                </button>
                                            </span>
                                            <span className='material-icons jpx-lib-ic' aria-hidden='true'>{iconFor(l.CollectionType)}</span>
                                            <span className='jpx-lib-name'>{l.Name}</span>
                                            <button type='button' aria-label={off ? 'Show on Home' : 'Hide from Home'} style={{ ...btn, marginLeft: 'auto' }} onClick={() => toggle(String(l.Id))}>
                                                <span className={`material-icons jpx-lib-check${off ? '' : ' on'}`} aria-hidden='true'>{off ? 'visibility_off' : 'visibility'}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                </div>
                <button type='button' className='jpx-pin-cancel' onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

export function promptHomeLibraries(): Promise<void> {
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
        root.render(<HomeLibraries onDone={done} />);
    });
}
