// Imperative picker for Kids Mode "Blocked Genres / Tags". Lists the current server's genres as
// checkboxes and lets you type extra terms (e.g. a tag). Writes the chosen terms to the
// KIDS_BLOCKED_TERMS pref (synced). Matching is case-insensitive against each item's Genres/Tags.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getPref, setPref } from './jpxPrefs';
import { KIDS_BLOCKED_TERMS } from './jpxParental';
import './jpxPinPrompt.scss';

const norm = (s: string) => s.trim().toLowerCase();

function GenreSelect({ onDone }: { onDone: () => void }) {
    const [ genres, setGenres ] = useState<string[] | null>(null);
    const [ blocked, setBlocked ] = useState<string[]>(() => {
        const v = getPref<string[]>(KIDS_BLOCKED_TERMS, []);
        return Array.isArray(v) ? v.map(String) : [];
    });
    const [ custom, setCustom ] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const apiClient = ServerConnections.currentApiClient() as {
                    getGenres: (u: string, o: unknown) => Promise<{ Items?: Array<{ Name?: string }> }>;
                    getCurrentUserId: () => string;
                } | undefined;
                if (!apiClient || typeof apiClient.getGenres !== 'function') { setGenres([]); return; }
                const res = await apiClient.getGenres(apiClient.getCurrentUserId(), { SortBy: 'SortName', Recursive: true, EnableTotalRecordCount: false });
                setGenres((res?.Items || []).map(g => String(g.Name || '')).filter(Boolean));
            } catch { setGenres([]); }
        })();
    }, []);

    const persist = (next: string[]) => { setBlocked(next); setPref(KIDS_BLOCKED_TERMS, next); };
    const isOn = (term: string) => blocked.some(b => norm(b) === norm(term));
    const toggle = (term: string) => {
        persist(isOn(term) ? blocked.filter(b => norm(b) !== norm(term)) : [ ...blocked, term ]);
    };
    const addCustom = () => {
        const t = custom.trim();
        if (t && !isOn(t)) persist([ ...blocked, t ]);
        setCustom('');
    };

    // Show blocked-but-not-in-genre-list terms (e.g. custom tags) at the top so they can be removed.
    const extras = blocked.filter(b => !(genres || []).some(g => norm(g) === norm(b)));
    const rows = [ ...extras, ...(genres || []) ];

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onDone(); }}>
            <div className='jpx-pin-card jpx-pin-card-wide' role='dialog' aria-modal='true' aria-label='Blocked Genres and Tags'>
                <div className='jpx-pin-lock material-icons' aria-hidden='true'>block</div>
                <div className='jpx-pin-title'>Blocked Genres &amp; Tags</div>
                <div className='jpx-pin-sub'>Anything with a checked genre or tag is restricted in Kids Mode.</div>
                <div className='jpx-genre-add'>
                    <input
                        className='jpx-genre-input'
                        placeholder='Add a genre or tag…'
                        value={custom}
                        onChange={e => setCustom(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
                    />
                    <button type='button' className='jpx-genre-addbtn' onClick={addCustom}>Add</button>
                </div>
                <div className='jpx-lib-list'>
                    {genres === null ? <div className='jpx-lib-empty'>Loading…</div>
                        : rows.length === 0 ? <div className='jpx-lib-empty'>No genres found — type one above.</div>
                            : rows.map(g => {
                                const on = isOn(g);
                                return (
                                    <button key={g} type='button' className={`jpx-lib-row${on ? ' hidden-on' : ''}`} onClick={() => toggle(g)}>
                                        <span className='material-icons jpx-lib-ic' aria-hidden='true'>{on ? 'block' : 'label_outline'}</span>
                                        <span className='jpx-lib-name'>{g}</span>
                                        <span className={`material-icons jpx-lib-check${on ? ' on' : ''}`} aria-hidden='true'>{on ? 'check_box' : 'check_box_outline_blank'}</span>
                                    </button>
                                );
                            })}
                </div>
                <button type='button' className='jpx-pin-cancel' onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

export function promptGenreSelect(): Promise<void> {
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
        root.render(<GenreSelect onDone={done} />);
    });
}
