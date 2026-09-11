// Imperative 1–10 rating picker. Resolves to the chosen rating (1–10), 0 to clear, or undefined if
// cancelled. Used by the detail-page Rate button; the caller pushes the result to Simkl/Trakt.
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import './jpxAccountPrompt.scss';

function RateScreen({ current, onDone }: { current: number; onDone: (v: number | undefined) => void }) {
    const [hover, setHover] = useState(0);
    const [exiting, setExiting] = useState(false);
    const finish = (v: number | undefined) => { setExiting(true); setTimeout(() => onDone(v), 300); };
    const shown = hover || current;
    return (
        <div className='jpx-account-overlay' onClick={() => finish(undefined)}>
            <div className={'jpx-account-card jpx-scrobble-card' + (exiting ? ' jpx-account-card--exit' : '')} onClick={e => e.stopPropagation()}>
                <div className='jpx-account-title'>Rate this title</div>
                <div className='jpx-account-sub'>{shown ? shown + ' / 10' : 'Tap a number'}</div>
                <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'center', margin: '.8rem 0 1rem', flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                        <button key={n} type='button'
                            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
                            onClick={() => finish(n)}
                            style={{
                                width: 40, height: 40, borderRadius: 9, cursor: 'pointer', fontWeight: 800, fontSize: '.95rem',
                                border: '1px solid rgba(255,255,255,0.16)',
                                background: n <= shown ? 'var(--jpx-t-accent, #c235ff)' : 'rgba(255,255,255,0.05)',
                                color: n <= shown ? 'var(--jpx-t-on-accent,#fff)' : 'rgba(255,255,255,0.8)'
                            }}>{n}</button>
                    ))}
                </div>
                {current ? <button type='button' className='jpx-account-submit jpx-account-submit--secondary' onClick={() => finish(0)}>Clear rating</button> : null}
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={() => finish(undefined)}>Cancel</button>
            </div>
        </div>
    );
}

export function promptRate(current: number): Promise<number | undefined> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'jpx-account-host';
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = (v: number | undefined) => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve(v);
        };
        root.render(<RateScreen current={current} onDone={done} />);
    });
}

export default promptRate;
