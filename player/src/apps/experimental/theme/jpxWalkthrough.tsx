// Umbry — first-run walkthrough. A short, closable carousel over the app with real screenshots of
// the basics: choose an Umbry Server or this device only → create your account → add a media
// server → pick libraries → home. Shown on first launch (before the connect screen), on every launch
// when "Show on startup" is ticked, and from Settings > Support Umbry. Imperative + promise-based,
// like promptPin.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import shotConnect from '../../../assets/img/walkthrough/1-connect.jpg';
import shotAccount from '../../../assets/img/walkthrough/2-account.jpg';
import shotServer from '../../../assets/img/walkthrough/3-server.jpg';
import shotLibraries from '../../../assets/img/walkthrough/4-libraries.jpg';
import shotHome from '../../../assets/img/walkthrough/5-home.jpg';
import './jpxWalkthrough.scss';

const DONE_KEY = 'jpx-walkthrough-done';
const STARTUP_KEY = 'jpx-walkthrough-startup'; // '1' = show every time Umbry starts

interface Slide { img: string; title: string; body: string }

const SLIDES: Slide[] = [
    {
        img: shotConnect,
        title: 'Choose how to use Umbry',
        body: 'Connect to your Umbry Server to keep your servers and settings in sync on every device. No Umbry Server? Tap “Use this device only” and everything stays on this device.'
    },
    {
        img: shotAccount,
        title: 'Create your Umbry account',
        body: 'Using an Umbry Server? Create an account with an email and password. It lives on your own server, not on the internet. Save the recovery code it shows you.'
    },
    {
        img: shotServer,
        title: 'Add your media servers',
        body: 'Enter the address of your Jellyfin or Emby server, or sign in with Plex, then log in with that server’s username and password. You can add more servers later.'
    },
    {
        img: shotLibraries,
        title: 'Pick your libraries',
        body: 'Choose which of the server’s libraries show up in Umbry. Change it anytime in Settings.'
    },
    {
        img: shotHome,
        title: 'You’re all set',
        body: 'Your home screen shows what to watch next and all your libraries. Tap the Umbry button in the corner for navigation, servers and Settings.'
    }
];

function readFlag(key: string): boolean {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

let shownThisLaunch = false;
/** First launch, or every launch when "Show on startup" is ticked — at most once per app start. */
export function shouldShowWalkthroughAtStartup(): boolean {
    if (shownThisLaunch) return false;
    return !readFlag(DONE_KEY) || readFlag(STARTUP_KEY);
}

function Tour({ onDone }: { onDone: () => void }) {
    const [ i, setI ] = useState(0);
    const last = i === SLIDES.length - 1;
    const touchX = useRef<number | null>(null);
    const [ onStartup, setOnStartup ] = useState(() => readFlag(STARTUP_KEY));
    const toggleStartup = (v: boolean) => {
        setOnStartup(v);
        try { localStorage.setItem(STARTUP_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    };

    const next = useCallback(() => { if (last) onDone(); else setI(n => n + 1); }, [ last, onDone ]);
    const back = useCallback(() => setI(n => Math.max(0, n - 1)), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onDone();
            else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
            else if (e.key === 'ArrowLeft') back();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [ next, back, onDone ]);

    const s = SLIDES[i];
    return (
        <div className='jpx-tour-overlay' role='dialog' aria-modal='true' aria-label='Welcome to Umbry'>
            <div
                className='jpx-tour-card'
                onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
                onTouchEnd={e => {
                    if (touchX.current === null) return;
                    const dx = e.changedTouches[0].clientX - touchX.current;
                    touchX.current = null;
                    if (dx < -40) next(); else if (dx > 40) back();
                }}
            >
                <div className='jpx-tour-top'>
                    <span className='jpx-tour-step'>Step {i + 1} of {SLIDES.length}</span>
                    <button type='button' className='jpx-tour-close' onClick={onDone} aria-label='Close'>
                        <span className='material-icons' aria-hidden='true'>close</span>
                    </button>
                </div>
                <div className='jpx-tour-shot'>
                    <img key={s.img} src={s.img} alt='' draggable={false} />
                </div>
                <div className='jpx-tour-title'>{s.title}</div>
                <div className='jpx-tour-body'>{s.body}</div>
                <div className='jpx-tour-dots' aria-hidden='true'>
                    {SLIDES.map((_, n) => <button key={n} type='button' tabIndex={-1} className={'jpx-tour-dot' + (n === i ? ' on' : '')} onClick={() => setI(n)} />)}
                </div>
                <label className='jpx-tour-startup'>
                    <input type='checkbox' checked={onStartup} onChange={e => toggleStartup(e.target.checked)} />
                    <span>Show on startup</span>
                </label>
                <div className='jpx-tour-nav'>
                    <button type='button' className='jpx-tour-back' onClick={back} disabled={i === 0}>Back</button>
                    <button type='button' className='jpx-tour-next' onClick={next} autoFocus>{last ? 'Get started' : 'Next'}</button>
                </div>
            </div>
        </div>
    );
}

/** Show the walkthrough; resolves when the user finishes or closes it. Marks it seen either way. */
export function promptWalkthrough(): Promise<void> {
    shownThisLaunch = true;
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'jpx-tour-host';
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = () => {
            try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve();
        };
        root.render(<Tour onDone={done} />);
    });
}
