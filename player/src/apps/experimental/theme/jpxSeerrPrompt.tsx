// Imperative Seerr (Jellyseerr / Overseerr) link dialog for Settings. Enter the server address and
// an optional API key, test the connection, and save. Reuses the account screen's visual language.
// Call promptSeerr() from the settings action dispatcher (or the nav) and await it.

import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { getSeerr, setSeerr, testSeerr, normUrl } from './jpxSeerr';
import './jpxAccountPrompt.scss';

function SeerrScreen({ onDone }: { onDone: () => void }) {
    const existing = getSeerr();
    const [ url, setUrl ] = useState(existing.url);
    const [ key, setKey ] = useState(existing.key);
    const [ testing, setTesting ] = useState(false);
    const [ ok, setOk ] = useState('');
    const [ err, setErr ] = useState('');
    const [ exiting, setExiting ] = useState(false);

    const finish = () => { setExiting(true); setTimeout(onDone, 340); };
    const clearStatus = () => { setOk(''); setErr(''); };

    const test = async () => {
        setTesting(true); clearStatus();
        const res = await testSeerr(url, key);
        setTesting(false);
        if (res.ok) setOk('Connected' + (res.version ? ' · v' + res.version : ''));
        else setErr(res.error || 'Could not connect.');
    };

    const save = () => { setSeerr(url, key); finish(); };

    return (
        <div className='jpx-account-overlay'>
            <div className='jpx-account-aurora' aria-hidden='true'>
                <span className='jpx-account-blob b1' />
                <span className='jpx-account-blob b2' />
                <span className='jpx-account-blob b3' />
            </div>
            <div className={'jpx-account-card' + (exiting ? ' jpx-account-card--exit' : '')}>
                <div className='jpx-account-title'>Link your request server</div>
                <div className='jpx-account-sub'>Connect Jellyseerr or Overseerr so you can browse and request titles inside Umbry.</div>
                {err ? <div className='jpx-account-err'>{err}</div> : null}
                {ok ? <div className='jpx-account-detect jpx-account-detect--found'>{'✓ ' + ok}</div> : null}
                <input
                    className='jpx-account-input'
                    type='text'
                    inputMode='url'
                    placeholder='https://requests.example.com'
                    value={url}
                    onChange={e => { setUrl(e.target.value); clearStatus(); }}
                    autoFocus
                    spellCheck={false}
                    autoCapitalize='none'
                />
                <input
                    className='jpx-account-input'
                    type='text'
                    placeholder='API key (optional)'
                    value={key}
                    onChange={e => { setKey(e.target.value); clearStatus(); }}
                    spellCheck={false}
                    autoCapitalize='none'
                />
                <div className='jpx-account-hint'>Find the API key in Jellyseerr &rarr; Settings &rarr; General. It is only used for the connection test.</div>
                <button type='button' className='jpx-account-submit jpx-account-submit--secondary' onClick={test} disabled={testing || !normUrl(url)}>{testing ? 'Testing…' : 'Test connection'}</button>
                <button type='button' className='jpx-account-submit' onClick={save} disabled={!normUrl(url)}>Save</button>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={finish}>Cancel</button>
            </div>
        </div>
    );
}

export function promptSeerr(): Promise<void> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'jpx-account-host';
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = () => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve();
        };
        root.render(<SeerrScreen onDone={done} />);
    });
}

export default promptSeerr;
