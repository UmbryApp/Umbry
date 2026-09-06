// Imperative Plex sign-in dialog. Call promptPlexSignIn(base) after detecting a Plex server; it runs
// the sign-in (OAuth button or email/password), then registers the server with the user's token via
// addPlexServer, and resolves the PlexServer (or null if cancelled/failed). All errors shown inline.

import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { signInWithPlexOAuth, signInWithPlexPassword } from './jpxPlexAuth';
import { addPlexServer, type PlexServer } from './jpxPlex';
import './jpxPlexSignIn.scss';

type Phase = 'choose' | 'oauth' | 'password' | 'registering';

function PlexSignIn({ base, onDone }: { base: string; onDone: (srv: PlexServer | null) => void }) {
    const [ phase, setPhase ] = useState<Phase>('choose');
    const [ email, setEmail ] = useState('');
    const [ password, setPassword ] = useState('');
    const [ code, setCode ] = useState('');
    const [ needs2fa, setNeeds2fa ] = useState(false);
    const [ error, setError ] = useState('');
    const [ busy, setBusy ] = useState(false);

    // Turn a token into a registered server (validates address + access).
    const register = async (token: string) => {
        setPhase('registering'); setError(''); setBusy(true);
        try {
            const srv = await addPlexServer(base, token);
            if (srv) { onDone(srv); return; }
            setError('That account signed in, but it doesn’t have access to this server (or the address is wrong).');
            setPhase('choose');
        } catch {
            setError('Signed in, but couldn’t reach that Plex server. Check the address and try again.');
            setPhase('choose');
        } finally {
            setBusy(false);
        }
    };

    const doOAuth = async () => {
        setPhase('oauth'); setError(''); setBusy(true);
        try {
            let popupBlocked = false;
            const token = await signInWithPlexOAuth((w) => { if (!w) popupBlocked = true; });
            if (popupBlocked) { setError('Your browser blocked the Plex sign-in popup. Allow popups for this site and try again.'); setPhase('choose'); setBusy(false); return; }
            if (!token) { setError('Plex sign-in was cancelled or timed out.'); setPhase('choose'); setBusy(false); return; }
            await register(token);
        } catch {
            setError('Couldn’t start Plex sign-in. Try the email & password option below.');
            setPhase('choose'); setBusy(false);
        }
    };

    const doPassword = async () => {
        if (!email.trim() || !password) { setError('Enter your Plex email and password.'); return; }
        setBusy(true); setError('');
        const res = await signInWithPlexPassword(email.trim(), password, needs2fa ? code.trim() : undefined);
        if (res.token) { await register(res.token); return; }
        if (res.needs2fa) { setNeeds2fa(true); setError('This account has two-factor on — enter your verification code.'); setBusy(false); return; }
        setError(res.error || 'Sign-in failed.'); setBusy(false);
    };

    const close = () => onDone(null);

    return (
        <div className='jpx-pin-overlay' onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}>
            <div className='jpx-pin-card jpx-plex-card' role='dialog' aria-modal='true' aria-label='Sign in to Plex'>
                <div className='jpx-plex-logo material-icons' aria-hidden='true'>play_circle</div>
                <div className='jpx-pin-title'>Sign in to Plex</div>
                <div className='jpx-pin-sub'>Connect with your own Plex account to see the libraries shared with you.</div>
                {error ? <div className='jpx-pin-sub jpx-pin-err'>{error}</div> : null}

                {phase === 'oauth' ? (
                    <div className='jpx-plex-waiting'>
                        <div className='jpx-plex-spinner' aria-hidden='true' />
                        <div>Waiting for you to authorize in the Plex window…</div>
                        <button type='button' className='jpx-pin-cancel' onClick={close}>Cancel</button>
                    </div>
                ) : phase === 'registering' ? (
                    <div className='jpx-plex-waiting'>
                        <div className='jpx-plex-spinner' aria-hidden='true' />
                        <div>Connecting to the server…</div>
                    </div>
                ) : (
                    <>
                        <button type='button' className='jpx-plex-oauth-btn' onClick={doOAuth} disabled={busy}>
                            <span className='material-icons' aria-hidden='true'>login</span> Sign in with Plex
                        </button>

                        <div className='jpx-plex-or'><span>or use email &amp; password</span></div>

                        <input className='jpx-genre-input jpx-plex-field' type='email' placeholder='Plex email'
                            value={email} onChange={e => setEmail(e.target.value)} autoComplete='username' />
                        <input className='jpx-genre-input jpx-plex-field' type='password' placeholder='Password'
                            value={password} onChange={e => setPassword(e.target.value)} autoComplete='current-password'
                            onKeyDown={e => { if (e.key === 'Enter' && !needs2fa) doPassword(); }} />
                        {needs2fa ? (
                            <input className='jpx-genre-input jpx-plex-field' type='text' inputMode='numeric' placeholder='2-factor code'
                                value={code} onChange={e => setCode(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') doPassword(); }} />
                        ) : null}
                        <button type='button' className='jpx-plex-signin-btn' onClick={doPassword} disabled={busy}>Sign In</button>
                        <button type='button' className='jpx-pin-cancel' onClick={close} disabled={busy}>Cancel</button>
                    </>
                )}
            </div>
        </div>
    );
}

export function promptPlexSignIn(base: string): Promise<PlexServer | null> {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        let root: Root | null = createRoot(host);
        const done = (srv: PlexServer | null) => {
            try { root?.unmount(); } catch { /* ignore */ }
            root = null;
            try { host.remove(); } catch { /* ignore */ }
            resolve(srv);
        };
        root.render(<PlexSignIn base={base} onDone={done} />);
    });
}
