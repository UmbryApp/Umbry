// Umbry — Player Buttons manager. Reorder / hide the buttons in the video player's options menu.
// Writes jpx-pref-osdButtons ({ order, hidden }); jpxVideoOsd.js reads that key on build to reorder
// and hide the corresponding buttons. Keys MUST match the button `title` strings set in jpxVideoOsd.
// Mirrors the imperative createRoot + Promise shell of jpxLibrarySelection; reuses jpxPinPrompt.scss.

import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { getPref, setPref } from './jpxPrefs';
import './jpxPinPrompt.scss';

const ACCENT = 'var(--jpx-t-accent, #9385F5)';

const DEFAULT_ORDER = ['Favorite', 'Playback speed', 'Chapters', 'Subtitle Track', 'Audio Track', 'Cast & Crew', 'Remote Playback', 'Bitrate', 'Aspect ratio', 'Fullscreen', 'Playback Information'];
const ICONS: Record<string, string> = {
    'Favorite': 'favorite', 'Playback speed': 'slow_motion_video', 'Chapters': 'bookmark',
    'Subtitle Track': 'subtitles', 'Audio Track': 'music_note', 'Cast & Crew': 'people_alt',
    'Remote Playback': 'cast', 'Bitrate': 'video_settings', 'Aspect ratio': 'crop',
    'Fullscreen': 'fullscreen', 'Playback Information': 'info_outline'
};

interface Pref { order: string[]; hidden: string[] }

function loadPref(): Pref {
    const p = getPref<Pref>('osdButtons', { order: DEFAULT_ORDER, hidden: [] });
    const order = Array.isArray(p?.order) ? p.order.filter(t => DEFAULT_ORDER.includes(t)) : [];
    DEFAULT_ORDER.forEach(t => { if (!order.includes(t)) order.push(t); }); // append buttons added later
    const hidden = Array.isArray(p?.hidden) ? p.hidden.filter(t => DEFAULT_ORDER.includes(t)) : [];
    return { order, hidden };
}

const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: 'none', color: 'inherit', cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.25 : 0.85, padding: '0.15em', display: 'inline-flex', alignItems: 'center'
});
const primaryBtn: React.CSSProperties = {
    marginTop: '1.1em', padding: '0.7em 1.5em', borderRadius: '10px', border: 'none',
    background: ACCENT, color: '#fff', fontWeight: 600, cursor: 'pointer', alignSelf: 'center'
};

function PlayerButtons({ onDone }: { onDone: () => void }) {
    const [ pref, setPrefState ] = useState<Pref>(() => loadPref());
    const save = (next: Pref) => { setPrefState(next); setPref('osdButtons', next); };
    const move = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= pref.order.length) return;
        const order = pref.order.slice();
        [ order[i], order[j] ] = [ order[j], order[i] ];
        save({ order, hidden: pref.hidden });
    };
    const toggle = (t: string) => {
        const hidden = pref.hidden.includes(t) ? pref.hidden.filter(x => x !== t) : [ ...pref.hidden, t ];
        save({ order: pref.order, hidden });
    };
    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onDone(); }}>
            <div className='jpx-pin-card jpx-pin-card-wide' role='dialog' aria-modal='true' aria-label='Player Buttons'>
                <div className='jpx-pin-lock material-icons' aria-hidden='true' style={{ color: ACCENT }}>tune</div>
                <div className='jpx-pin-title'>Player Buttons</div>
                <div className='jpx-pin-sub'>Reorder the buttons in the player&rsquo;s options menu, or switch one off to hide it.</div>
                <div className='jpx-lib-list'>
                    {pref.order.map((t, i) => {
                        const on = !pref.hidden.includes(t);
                        return (
                            <div key={t} className='jpx-lib-row' style={{ cursor: 'default' }}>
                                <span className='material-icons jpx-lib-ic' aria-hidden='true'>{ICONS[t] || 'radio_button_unchecked'}</span>
                                <span className='jpx-lib-name' style={on ? undefined : { opacity: 0.5 }}>{t}</span>
                                <button type='button' aria-label='Move up' style={arrowBtn(i === 0)} disabled={i === 0} onClick={() => move(i, -1)}>
                                    <span className='material-icons' aria-hidden='true'>keyboard_arrow_up</span>
                                </button>
                                <button type='button' aria-label='Move down' style={arrowBtn(i === pref.order.length - 1)} disabled={i === pref.order.length - 1} onClick={() => move(i, 1)}>
                                    <span className='material-icons' aria-hidden='true'>keyboard_arrow_down</span>
                                </button>
                                <button type='button' aria-label={on ? 'Hide' : 'Show'} style={{ ...arrowBtn(false), marginLeft: '0.35em' }} onClick={() => toggle(t)}>
                                    <span className='material-icons' aria-hidden='true' style={{ color: on ? ACCENT : undefined, opacity: on ? 1 : 0.55 }}>{on ? 'visibility' : 'visibility_off'}</span>
                                </button>
                            </div>
                        );
                    })}
                </div>
                <button type='button' style={primaryBtn} onClick={onDone}>Done</button>
            </div>
        </div>
    );
}

export function promptPlayerButtons(): Promise<void> {
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
        root.render(<PlayerButtons onDone={done} />);
    });
}

export default promptPlayerButtons;
