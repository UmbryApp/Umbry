// Imperative library picker for Kids Mode "Hidden Libraries". Lists the current server's libraries
// with checkboxes and writes the selected ids to the KIDS_HIDDEN_LIBS pref (synced). Themed to
// match the PIN pad. Resolves when the user closes it.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getPref, setPref } from './jpxPrefs';
import { KIDS_HIDDEN_LIBS } from './jpxParental';
import './jpxPinPrompt.scss';

interface Lib { Id: string; Name: string; CollectionType?: string }

function LibrarySelect({ onDone }: { onDone: () => void }) {
    const [ libs, setLibs ] = useState<Lib[] | null>(null);
    const [ hidden, setHidden ] = useState<string[]>(() => {
        const v = getPref<string[]>(KIDS_HIDDEN_LIBS, []);
        return Array.isArray(v) ? v.map(String) : [];
    });
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
                setLibs((res?.Items || []) as Lib[]);
            } catch {
                setError('Could not load libraries');
                setLibs([]);
            }
        })();
    }, []);

    const toggle = (id: string) => {
        setHidden(prev => {
            const next = prev.includes(id) ? prev.filter(x => x !== id) : [ ...prev, id ];
            setPref(KIDS_HIDDEN_LIBS, next);
            return next;
        });
    };

    const iconFor = (t?: string) => {
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
    };

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onDone(); }}>
            <div className='jpx-pin-card jpx-pin-card-wide' role='dialog' aria-modal='true' aria-label='Hidden Libraries'>
                <div className='jpx-pin-lock material-icons' aria-hidden='true'>video_library</div>
                <div className='jpx-pin-title'>Hidden Libraries</div>
                <div className='jpx-pin-sub'>Selected libraries are hidden while Kids Mode is on.</div>
                <div className='jpx-lib-list'>
                    {libs === null ? <div className='jpx-lib-empty'>Loading…</div>
                        : error ? <div className='jpx-lib-empty'>{error}</div>
                            : libs.length === 0 ? <div className='jpx-lib-empty'>No libraries found</div>
                                : libs.map(l => {
                                    const on = hidden.includes(String(l.Id));
                                    return (
                                        <button key={l.Id} type='button' className={`jpx-lib-row${on ? ' hidden-on' : ''}`} onClick={() => toggle(String(l.Id))}>
                                            <span className='material-icons jpx-lib-ic' aria-hidden='true'>{iconFor(l.CollectionType)}</span>
                                            <span className='jpx-lib-name'>{l.Name}</span>
                                            <span className={`material-icons jpx-lib-check${on ? ' on' : ''}`} aria-hidden='true'>{on ? 'visibility_off' : 'visibility'}</span>
                                        </button>
                                    );
                                })}
                </div>
                <button type='button' className='jpx-pin-cancel' onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

export function promptLibrarySelect(): Promise<void> {
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
        root.render(<LibrarySelect onDone={done} />);
    });
}
