// Umbry — "Connect to an Umbry Server" from Settings. For people who started with "Use this device
// only" and installed Umbry Server later: scans the network, lists every Umbry Server that answers,
// lets them pick one (or type an address), and explains how to get Umbry Server when none is found.
// Resolves true once a server is chosen (sync mode switched to 'server'); the caller then runs the
// account sign-in. Imperative + promise-based, like promptPin.
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { addKnownServer, detectAllServers, probeServer, setServerUrl, setSyncMode } from './jpxAccount';
import './jpxServerConnect.scss';

const GET_SERVER_URL = 'https://umbry.org/#server';

type View = 'scanning' | 'list' | 'none' | 'manual';

function hostOf(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function Chooser({ onDone }: { onDone: (ok: boolean) => void }) {
    const [ view, setView ] = useState<View>('scanning');
    const [ found, setFound ] = useState<string[]>([]);
    const [ manual, setManual ] = useState('');
    const [ busy, setBusy ] = useState('');
    const [ err, setErr ] = useState('');

    const scan = useCallback(async () => {
        setErr(''); setView('scanning');
        let candidates: string[] = [];
        try { candidates = await detectAllServers(); } catch { /* ignore */ }
        // keep only servers that answer right now (known-but-offline ones are left out)
        const checks = await Promise.all(candidates.map(async u => ((await probeServer(u)).ok ? u : '')));
        const live = [ ...new Set(checks.filter(Boolean)) ];
        setFound(live);
        setView(live.length ? 'list' : 'none');
    }, []);

    useEffect(() => { void scan(); }, [ scan ]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [ onDone ]);

    const choose = async (url: string) => {
        const u = url.trim();
        if (!u) return;
        setErr(''); setBusy(u);
        const r = await probeServer(u);
        setBusy('');
        if (!r.ok) { setErr(r.error || 'Could not reach that Umbry Server.'); return; }
        setServerUrl(u); setSyncMode('server'); addKnownServer(u);
        onDone(true);
    };

    return (
        <div className='jpx-srvc-overlay' role='dialog' aria-modal='true' aria-label='Connect to an Umbry Server'>
            <div className='jpx-srvc-card'>
                <div className='jpx-srvc-top'>
                    <span className='material-icons jpx-srvc-icon' aria-hidden='true'>dns</span>
                    <button type='button' className='jpx-srvc-close' onClick={() => onDone(false)} aria-label='Close'>
                        <span className='material-icons' aria-hidden='true'>close</span>
                    </button>
                </div>
                <div className='jpx-srvc-title'>Connect to an Umbry Server</div>
                <div className='jpx-srvc-sub'>Sync your servers, watchlist and settings across all your devices. Your servers and settings on this device are kept.</div>
                {err ? <div className='jpx-srvc-err'>{err}</div> : null}

                {view === 'scanning' ? (
                    <div className='jpx-srvc-scan'><span className='jpx-srvc-spin' />Looking for Umbry Servers on your network…</div>
                ) : null}

                {view === 'list' ? (
                    <>
                        <div className='jpx-srvc-label'>Found {found.length === 1 ? '1 server' : `${found.length} servers`} — pick one:</div>
                        <div className='jpx-srvc-list'>
                            {found.map(u => (
                                <button key={u} type='button' className='jpx-srvc-item' disabled={!!busy} onClick={() => choose(u)}>
                                    <span className='material-icons' aria-hidden='true'>dns</span>
                                    <span className='jpx-srvc-host'>{hostOf(u)}</span>
                                    <span className='jpx-srvc-go'>{busy === u ? 'Connecting…' : 'Connect'}</span>
                                </button>
                            ))}
                        </div>
                        <div className='jpx-srvc-links'>
                            <button type='button' className='jpx-srvc-link' onClick={() => void scan()}>Scan again</button>
                            <button type='button' className='jpx-srvc-link' onClick={() => { setErr(''); setView('manual'); }}>Enter address manually</button>
                        </div>
                    </>
                ) : null}

                {view === 'none' ? (
                    <>
                        <div className='jpx-srvc-none'>
                            <strong>No Umbry Server found on your network.</strong>
                            Umbry Server is a free companion app. Install it on a computer at home (Windows, Mac or Linux), make sure it’s running, then scan again.
                        </div>
                        <button type='button' className='jpx-srvc-primary' onClick={() => window.open(GET_SERVER_URL, '_blank')}>Get Umbry Server</button>
                        <div className='jpx-srvc-links'>
                            <button type='button' className='jpx-srvc-link' onClick={() => void scan()}>Scan again</button>
                            <button type='button' className='jpx-srvc-link' onClick={() => { setErr(''); setView('manual'); }}>Enter address manually</button>
                        </div>
                    </>
                ) : null}

                {view === 'manual' ? (
                    <form className='jpx-srvc-manual' onSubmit={e => { e.preventDefault(); void choose(manual); }}>
                        <input className='jpx-srvc-input' type='text' inputMode='url' autoFocus placeholder='e.g. 192.168.1.100:8790'
                            value={manual} onChange={e => { setManual(e.target.value); setErr(''); }} />
                        <button type='submit' className='jpx-srvc-primary' disabled={!!busy || !manual.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
                        <div className='jpx-srvc-links'>
                            <button type='button' className='jpx-srvc-link' onClick={() => void scan()}>‹ Back to scanning</button>
                        </div>
                    </form>
                ) : null}
            </div>
        </div>
    );
}

/** Pick an Umbry Server. Resolves true when one was chosen (sync mode is now 'server'). */
export function promptConnectServer(): Promise<boolean> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'jpx-srvc-host-root';
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = (ok: boolean) => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve(ok);
        };
        root.render(<Chooser onDone={done} />);
    });
}
