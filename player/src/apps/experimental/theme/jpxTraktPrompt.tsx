// Imperative Trakt link dialog. Device-code flow: shows a short code + trakt.tv/activate, polls until
// the user authorizes, then reports "Connected as …". If the build has no Trakt app key, offers fields
// to paste one. When linked, offers a scrobbling toggle + Disconnect. Reuses the account visual style.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { isConfigured, isLinked, unlink, startDeviceAuth, pollDeviceToken, getMe, scrobbleEnabled, setScrobbleEnabled, type DeviceCode } from './jpxTrakt';
import './jpxAccountPrompt.scss';

function TraktScreen({ onDone }: { onDone: () => void }) {
    const [configured, setConfigured] = useState(isConfigured());
    const [linked, setLinked] = useState(isLinked());
    const [me, setMe] = useState('');
    const [cid, setCid] = useState('');
    const [csec, setCsec] = useState('');
    const [dev, setDev] = useState<DeviceCode | null>(null);
    const [err, setErr] = useState('');
    const [scrob, setScrob] = useState(scrobbleEnabled());
    const [exiting, setExiting] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const finish = () => { setExiting(true); setTimeout(onDone, 340); };

    useEffect(() => {
        if (linked) { void getMe().then(u => { if (u) setMe(u.username || u.name || ''); }); }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [linked]);

    const saveKeys = () => {
        if (!cid.trim()) { setErr('Enter your Trakt app Client ID.'); return; }
        try { localStorage.setItem('jpx-trakt-client', JSON.stringify({ id: cid.trim(), secret: csec.trim() })); } catch { /* ignore */ }
        setConfigured(true); setErr('');
    };

    const connect = async () => {
        setErr('');
        try {
            const d = await startDeviceAuth();
            setDev(d);
            const started = Date.now();
            pollRef.current = setInterval(async () => {
                if (Date.now() - started > d.expires_in * 1000) { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setErr('The code expired — please try again.'); return; }
                const res = await pollDeviceToken(d.device_code);
                if (res === 'done') { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setLinked(true); }
                else if (res === 'expired') { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setErr('The code expired — please try again.'); }
                else if (res === 'denied') { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setErr('Authorization was denied.'); }
            }, Math.max(3, d.interval || 5) * 1000);
        } catch (e) { setErr((e as Error).message || 'Could not reach Trakt.'); }
    };

    const disconnect = () => { unlink(); setLinked(false); setMe(''); };
    const toggleScrob = () => { const n = !scrob; setScrob(n); setScrobbleEnabled(n); };

    let body: React.ReactNode;
    if (linked) {
        body = (
            <>
                <div className='jpx-account-detect jpx-account-detect--found'>{'✓ Connected' + (me ? ' as ' + me : ' to Trakt')}</div>
                <div className='jpx-account-hint'>Umbry scrobbles what you watch to your Trakt history and progress. Movies and episodes are matched by their IMDb / TMDb / TVDb id.</div>
                <button type='button' className='jpx-account-submit jpx-account-submit--secondary' onClick={toggleScrob}>{scrob ? 'Scrobbling: On' : 'Scrobbling: Off'}</button>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={disconnect}>Disconnect Trakt</button>
                <button type='button' className='jpx-account-submit' onClick={finish}>Done</button>
            </>
        );
    } else if (dev) {
        body = (
            <>
                <div className='jpx-account-sub'>On any device, go to</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, margin: '.2rem 0 .8rem' }}>{dev.verification_url}</div>
                <div className='jpx-account-sub'>and enter this code:</div>
                <div style={{ fontSize: '2.1rem', fontWeight: 900, letterSpacing: '.22em', textAlign: 'center', margin: '.5rem 0 1rem', fontFamily: 'monospace' }}>{dev.user_code}</div>
                <div className='jpx-account-detect'>Waiting for you to authorize…</div>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setDev(null); }}>Cancel</button>
            </>
        );
    } else if (!configured) {
        body = (
            <>
                <div className='jpx-account-sub'>This build has no Trakt app key yet. Create a free app at trakt.tv/oauth/applications and paste its keys to enable Trakt.</div>
                {err ? <div className='jpx-account-err'>{err}</div> : null}
                <input className='jpx-account-input' type='text' placeholder='Trakt Client ID' value={cid} onChange={e => setCid(e.target.value)} spellCheck={false} autoCapitalize='none' autoFocus />
                <input className='jpx-account-input' type='text' placeholder='Trakt Client Secret' value={csec} onChange={e => setCsec(e.target.value)} spellCheck={false} autoCapitalize='none' />
                <button type='button' className='jpx-account-submit' onClick={saveKeys} disabled={!cid.trim()}>Save keys</button>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={finish}>Cancel</button>
            </>
        );
    } else {
        body = (
            <>
                <div className='jpx-account-sub'>Connect your Trakt account so Umbry can scrobble your plays and keep your history and progress in sync.</div>
                {err ? <div className='jpx-account-err'>{err}</div> : null}
                <button type='button' className='jpx-account-submit' onClick={connect}>Connect Trakt</button>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={finish}>Cancel</button>
            </>
        );
    }

    return (
        <div className='jpx-account-overlay'>
            <div className='jpx-account-aurora' aria-hidden='true'>
                <span className='jpx-account-blob b1' />
                <span className='jpx-account-blob b2' />
                <span className='jpx-account-blob b3' />
            </div>
            <div className={'jpx-account-card jpx-trakt-card' + (exiting ? ' jpx-account-card--exit' : '')}>
                <div className='jpx-account-title'>Trakt</div>
                {body}
            </div>
        </div>
    );
}

export function promptTrakt(): Promise<void> {
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
        root.render(<TraktScreen onDone={done} />);
    });
}

export default promptTrakt;
