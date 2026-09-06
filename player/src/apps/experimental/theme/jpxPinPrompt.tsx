// Imperative, promise-based PIN keypad. Call promptPin({...}) from anywhere (settings, nav pill,
// enforcement) and await a boolean. Mounts a themed numeric pad into a transient container and
// tears it down on resolve. Styling uses the Umbry theme tokens so it matches the user's
// selected App Theme, with a dark fallback.

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { verifyPin, setPin } from './jpxParental';
import './jpxPinPrompt.scss';

type Mode = 'verify' | 'set';
interface PromptOpts {
    mode: Mode;
    title?: string;
    subtitle?: string;
    length?: number;
}

const KEYS = [ '1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del' ];

function PinPad({ opts, onDone }: { opts: PromptOpts; onDone: (ok: boolean) => void }) {
    const len = opts.length ?? 4;
    const [ entry, setEntry ] = useState('');
    const [ firstPass, setFirstPass ] = useState<string | null>(null); // 'set' mode: captured first entry
    const [ error, setError ] = useState('');
    const [ shake, setShake ] = useState(false);
    const [ busy, setBusy ] = useState(false);

    const confirming = opts.mode === 'set' && firstPass !== null;
    const heading = opts.title
        || (opts.mode === 'set' ? (confirming ? 'Confirm your PIN' : 'Set a PIN') : 'Enter PIN');

    const fail = useCallback((msg: string) => {
        setError(msg);
        setShake(true);
        setEntry('');
        setTimeout(() => setShake(false), 420);
    }, []);

    const complete = useCallback(async (code: string) => {
        setBusy(true);
        try {
            if (opts.mode === 'verify') {
                const ok = await verifyPin(code);
                if (ok) { onDone(true); return; }
                fail('Incorrect PIN');
            } else if (firstPass === null) {
                setFirstPass(code);
                setEntry('');
                setError('');
            } else if (firstPass === code) {
                await setPin(code);
                onDone(true);
            } else {
                setFirstPass(null);
                fail('PINs didn’t match — start again');
            }
        } catch (err) {
            console.error('[jpxPin] submit failed', err);
            setFirstPass(null);
            fail('Something went wrong \u2014 try again');
        } finally {
            setBusy(false);
        }
    }, [ opts.mode, firstPass, onDone, fail ]);

    const pressRef = React.useRef<(k: string) => void>(() => {});
    const press = useCallback((k: string) => {
        if (busy) return;
        if (k === 'del') { setEntry(e => e.slice(0, -1)); setError(''); return; }
        if (!/^[0-9]$/.test(k)) return;
        setEntry(e => {
            if (e.length >= len) return e;
            const next = e + k;
            if (next.length === len) setTimeout(() => complete(next), 120);
            return next;
        });
    }, [ busy, len, complete ]);
    pressRef.current = press;

    // Physical keyboard support.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onDone(false); return; }
            if (e.key === 'Backspace') { pressRef.current('del'); return; }
            if (/^[0-9]$/.test(e.key)) pressRef.current(e.key);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [ onDone ]);

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onDone(false); }}>
            <div className={`jpx-pin-card${shake ? ' jpx-pin-shake' : ''}`} role='dialog' aria-modal='true' aria-label={heading}>
                <div className='jpx-pin-lock material-icons' aria-hidden='true'>{opts.mode === 'set' ? 'lock_reset' : 'lock'}</div>
                <div className='jpx-pin-title'>{heading}</div>
                {opts.subtitle && !error ? <div className='jpx-pin-sub'>{opts.subtitle}</div> : null}
                {error ? <div className='jpx-pin-sub jpx-pin-err'>{error}</div> : null}
                <div className='jpx-pin-dots'>
                    {Array.from({ length: len }).map((_, i) => (
                        <span key={i} className={`jpx-pin-dot${i < entry.length ? ' filled' : ''}`} />
                    ))}
                </div>
                <div className='jpx-pin-keys'>
                    {KEYS.map((k, i) => k === ''
                        ? <span key={i} className='jpx-pin-key jpx-pin-key-empty' />
                        : (
                            <button
                                key={i}
                                type='button'
                                className={`jpx-pin-key${k === 'del' ? ' jpx-pin-key-del' : ''}`}
                                onClick={() => press(k)}
                                disabled={busy}
                            >
                                {k === 'del' ? <span className='material-icons' aria-hidden='true'>backspace</span> : k}
                            </button>
                        ))}
                </div>
                <button type='button' className='jpx-pin-cancel' onClick={() => onDone(false)}>Cancel</button>
            </div>
        </div>
    );
}

export function promptPin(opts: PromptOpts): Promise<boolean> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'jpx-pin-host';
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = (ok: boolean) => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve(ok);
        };
        root.render(<PinPad opts={opts} onDone={done} />);
    });
}
