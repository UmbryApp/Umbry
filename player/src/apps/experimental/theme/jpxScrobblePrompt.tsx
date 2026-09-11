// Imperative "Scrobbling" dialog — links Simkl (free) and/or Trakt (needs a VIP app key) so Umbry can
// mark what you watch on those services. Both use a device-code flow (type a short code on your phone).
// One modal, generic over the two adapters. Reuses the account visual style; solid accent buttons.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import * as trakt from './jpxTrakt';
import * as simkl from './jpxSimkl';
import './jpxAccountPrompt.scss';

interface Provider {
    key: string; name: string; free: boolean;
    isConfigured: () => boolean; isLinked: () => boolean; unlink: () => void;
    startDeviceAuth: () => Promise<{ user_code: string; verification_url: string; device_code: string; expires_in: number; interval: number }>;
    poll: (dc: { user_code: string; device_code: string }) => Promise<string>;
    getMe: () => Promise<{ username?: string } | null>;
    scrobbleEnabled: () => boolean; setScrobbleEnabled: (b: boolean) => void;
    needsKey: boolean;
}

const PROVIDERS: Provider[] = [
    { key: 'simkl', name: 'Simkl', free: true, isConfigured: simkl.isConfigured, isLinked: simkl.isLinked, unlink: simkl.unlink, startDeviceAuth: simkl.startDeviceAuth, poll: (dc) => simkl.pollDeviceToken(dc.user_code), getMe: simkl.getMe, scrobbleEnabled: simkl.scrobbleEnabled, setScrobbleEnabled: simkl.setScrobbleEnabled, needsKey: false },
    { key: 'trakt', name: 'Trakt', free: false, isConfigured: trakt.isConfigured, isLinked: trakt.isLinked, unlink: trakt.unlink, startDeviceAuth: trakt.startDeviceAuth, poll: (dc) => trakt.pollDeviceToken(dc.device_code), getMe: trakt.getMe, scrobbleEnabled: trakt.scrobbleEnabled, setScrobbleEnabled: trakt.setScrobbleEnabled, needsKey: true }
];

function ScrobbleScreen({ onDone }: { onDone: () => void }) {
    const [view, setView] = useState<'home' | 'connect' | 'keys'>('home');
    const [active, setActive] = useState<Provider | null>(null);
    const [dev, setDev] = useState<{ user_code: string; verification_url: string } | null>(null);
    const [err, setErr] = useState('');
    const [tick, setTick] = useState(0);
    const [names, setNames] = useState<Record<string, string>>({});
    const [cid, setCid] = useState('');
    const [csec, setCsec] = useState('');
    const [exiting, setExiting] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const finish = () => { setExiting(true); setTimeout(onDone, 340); };
    const refresh = () => setTick(t => t + 1);

    useEffect(() => {
        PROVIDERS.forEach(p => { if (p.isLinked()) void p.getMe().then(u => { if (u && u.username) setNames(n => ({ ...n, [p.key]: u.username as string })); }); });
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [tick]);

    const connect = async (p: Provider) => {
        setActive(p); setErr(''); setDev(null); setView('connect');
        try {
            const d = await p.startDeviceAuth();
            setDev(d);
            const started = Date.now();
            pollRef.current = setInterval(async () => {
                if (Date.now() - started > d.expires_in * 1000) { if (pollRef.current) clearInterval(pollRef.current); setErr('The code expired — please try again.'); setView('home'); return; }
                const res = await p.poll(d);
                if (res === 'done') { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setView('home'); refresh(); }
                else if (res === 'expired') { if (pollRef.current) clearInterval(pollRef.current); setErr('The code expired — please try again.'); setView('home'); }
                else if (res === 'denied') { if (pollRef.current) clearInterval(pollRef.current); setErr('Authorization was denied.'); setView('home'); }
            }, Math.max(3, d.interval || 5) * 1000);
        } catch (e) { setErr((e as Error).message || 'Could not connect.'); setView('home'); }
    };
    const onConnectClick = (p: Provider) => { if (p.needsKey && !p.isConfigured()) { setActive(p); setErr(''); setView('keys'); } else { void connect(p); } };
    const saveKeys = () => { if (!cid.trim()) { setErr('Enter your Trakt Client ID.'); return; } try { localStorage.setItem('jpx-trakt-client', JSON.stringify({ id: cid.trim(), secret: csec.trim() })); } catch { /* ignore */ } setErr(''); if (active) void connect(active); };
    const disconnect = (p: Provider) => { p.unlink(); refresh(); };
    const toggleScrob = (p: Provider) => { p.setScrobbleEnabled(!p.scrobbleEnabled()); refresh(); };
    const cancelConnect = () => { if (pollRef.current) clearInterval(pollRef.current); setDev(null); setView('home'); };

    let body: React.ReactNode;
    if (view === 'connect' && active && dev) {
        body = (
            <>
                <div className='jpx-account-sub'>On any device, go to</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, margin: '.2rem 0 .7rem' }}>{dev.verification_url}</div>
                <div className='jpx-account-sub'>and enter this code:</div>
                <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '.2em', textAlign: 'center', margin: '.5rem 0 1rem', fontFamily: 'monospace' }}>{dev.user_code}</div>
                <div className='jpx-account-detect'>{'Waiting for you to authorize ' + active.name + '…'}</div>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={cancelConnect}>Cancel</button>
            </>
        );
    } else if (view === 'keys' && active) {
        body = (
            <>
                <div className='jpx-account-sub'>Trakt made API keys VIP-only. If you have Trakt VIP, create an app at trakt.tv/oauth/applications and paste its keys. Otherwise use Simkl — it&apos;s free.</div>
                {err ? <div className='jpx-account-err'>{err}</div> : null}
                <input className='jpx-account-input' type='text' placeholder='Trakt Client ID' value={cid} onChange={e => setCid(e.target.value)} spellCheck={false} autoCapitalize='none' autoFocus />
                <input className='jpx-account-input' type='text' placeholder='Trakt Client Secret' value={csec} onChange={e => setCsec(e.target.value)} spellCheck={false} autoCapitalize='none' />
                <button type='button' className='jpx-account-submit' onClick={saveKeys} disabled={!cid.trim()}>Save &amp; connect</button>
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={() => { setErr(''); setView('home'); }}>Back</button>
            </>
        );
    } else {
        body = (
            <>
                <div className='jpx-account-sub'>Keep your watch history and progress in sync. Simkl is free; Trakt needs a VIP app key.</div>
                {err ? <div className='jpx-account-err'>{err}</div> : null}
                {PROVIDERS.map(p => {
                    const linked = p.isLinked();
                    return (
                        <div key={p.key} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '0.8rem 0.9rem', margin: '0.5rem 0', textAlign: 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <span style={{ fontWeight: 800, fontSize: '1.02rem' }}>{p.name}</span>
                                {p.free ? <span style={{ fontSize: '.68rem', fontWeight: 800, background: 'var(--jpx-t-accent, #c235ff)', color: 'var(--jpx-t-on-accent,#fff)', borderRadius: 6, padding: '1px 7px' }}>FREE</span> : <span style={{ fontSize: '.68rem', color: 'rgba(255,255,255,.5)' }}>VIP key</span>}
                            </div>
                            {linked
                                ? <div style={{ marginTop: '.55rem' }}>
                                    <div style={{ color: '#7ad07a', fontWeight: 700, fontSize: '.85rem', marginBottom: '.5rem' }}>{'✓ Connected' + (names[p.key] ? ' as ' + names[p.key] : '')}</div>
                                    <button type='button' className='jpx-account-submit jpx-account-submit--secondary' style={{ marginTop: 0 }} onClick={() => toggleScrob(p)}>{p.scrobbleEnabled() ? 'Scrobbling: On' : 'Scrobbling: Off'}</button>
                                    <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={() => disconnect(p)}>Disconnect</button>
                                </div>
                                : <button type='button' className='jpx-account-submit' style={{ marginTop: '.55rem' }} onClick={() => onConnectClick(p)}>{'Connect ' + p.name}</button>}
                        </div>
                    );
                })}
                <button type='button' className='jpx-account-submit jpx-account-submit--ghost' onClick={finish}>Done</button>
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
            <div className={'jpx-account-card jpx-scrobble-card' + (exiting ? ' jpx-account-card--exit' : '')}>
                <div className='jpx-account-title'>Scrobbling</div>
                {body}
            </div>
        </div>
    );
}

export function promptScrobble(): Promise<void> {
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
        root.render(<ScrobbleScreen onDone={done} />);
    });
}

export default promptScrobble;
