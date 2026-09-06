// Umbry account gate — a full-screen, imperative (createRoot + Promise) flow, following the same
// pattern as promptPin. Steps:
//   profiles — avatar tiles for remembered users on this server (click to sign in; PIN-gated)
//   server   — connect to your Umbry Server (or choose local-only)
//   auth     — sign in / create an account (with a server dropdown + a Remember-me opt-in)
//   avatar   — pick a profile avatar after a remembered sign-in
//   reset / recovery — password reset via recovery code
// Resolves once the user is authenticated against a server OR has chosen this-device-only.

import React, { useState, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
    loginAccount, registerAccount, resetPassword,
    getSyncMode, setSyncMode, getServerUrl, setServerUrl, probeServer, detectLocalServer,
    detectAllServers, addKnownServer, getProfilesFor, saveProfile, useProfile, removeProfile, type Profile
} from './jpxAccount';
import { AVATAR_PRESETS, renderAvatar, presetValue } from './jpxAvatars';
import { hasPin } from './jpxParental';
import { promptPin } from './jpxPinPrompt';
import jpxLogo from '../../../assets/img/umbry-wordmark.png';
import jpxMark from '../../../assets/img/umbry-logo.png';
import './jpxAccountPrompt.scss';

type Mode = 'login' | 'register';
type Step = 'profiles' | 'server' | 'auth' | 'avatar' | 'reset' | 'recovery';

function initialStep(): Step {
    if (getSyncMode() === 'server' && getProfilesFor(getServerUrl()).length > 0) return 'profiles';
    if (getSyncMode() === null) return 'server';
    return 'auth';
}

function serverLabel(url: string): string {
    return String(url || '').replace(/^https?:\/\//, '') || 'your server';
}

function AccountScreen({ onDone }: { onDone: () => void }) {
    const [ step, setStep ] = useState<Step>(initialStep());
    const [ serverUrl, setServerUrlState ] = useState(getServerUrl());
    const [ connecting, setConnecting ] = useState(false);
    const [ detecting, setDetecting ] = useState(getSyncMode() === null && !getServerUrl());
    const [ detected, setDetected ] = useState(false);
    const [ servers, setServers ] = useState<string[]>(() => {
        const cur = getServerUrl(); return cur ? [cur] : [];
    });

    const [ mode, setMode ] = useState<Mode>('login');
    const [ email, setEmail ] = useState('');
    const [ pw, setPw ] = useState('');
    const [ pw2, setPw2 ] = useState('');
    const [ remember, setRemember ] = useState(true);
    const [ busy, setBusy ] = useState(false);
    const [ err, setErr ] = useState('');
    const [ exiting, setExiting ] = useState(false);
    const [ code, setCode ] = useState('');
    const [ savedCode, setSavedCode ] = useState('');
    const [ copied, setCopied ] = useState(false);
    const [ pickAvatar, setPickAvatar ] = useState(presetValue('eclipse'));

    const [ profiles, setProfiles ] = useState<Profile[]>(() => getProfilesFor(getServerUrl()));

    const finish = () => { setExiting(true); setTimeout(onDone, 360); };
    const copyCode = () => { try { navigator.clipboard?.writeText(savedCode); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } };

    // First run: auto-detect a running Umbry Server and pre-fill it.
    useEffect(() => {
        let cancelled = false;
        if (getSyncMode() === null && !getServerUrl()) {
            detectLocalServer().then(found => {
                if (cancelled) return;
                setDetecting(false);
                if (found) { setServerUrlState(found); setDetected(true); }
            }).catch(() => { if (!cancelled) setDetecting(false); });
        }
        return () => { cancelled = true; };
    }, []);

    // Populate the server dropdown (detected + known) whenever we're on the auth step.
    useEffect(() => {
        let cancelled = false;
        if (step === 'auth') {
            detectAllServers().then(list => { if (!cancelled && list.length) setServers(list); }).catch(() => { /* ignore */ });
        }
        return () => { cancelled = true; };
    }, [step]);

    // ---- step: connect to the Umbry Server ----
    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(''); setConnecting(true);
        const res = await probeServer(serverUrl);
        setConnecting(false);
        if (!res.ok) { setErr(res.error || 'Could not reach that server'); return; }
        setServerUrl(serverUrl); setSyncMode('server'); addKnownServer(serverUrl);
        setErr('');
        const profs = getProfilesFor(getServerUrl());
        setProfiles(profs);
        setStep(profs.length ? 'profiles' : 'auth');
    };
    const useLocal = () => { setSyncMode('local'); finish(); };

    // ---- step: profiles (avatar sign-in) ----
    const pickProfile = async (p: Profile) => {
        setErr('');
        if (hasPin()) {
            const ok = await promptPin({ mode: 'verify', title: 'Enter your PIN', subtitle: 'Required to sign in on this device' });
            if (!ok) return;
        }
        setBusy(true);
        const r = await useProfile(p);
        setBusy(false);
        if (r === 'expired') { setEmail(p.email); setMode('login'); setErr('Your saved session expired — please sign in again.'); setStep('auth'); }
        else finish(); // ok | unsupported | offline → proceed with the (cached) session
    };
    const forgetProfile = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        removeProfile(id);
        const rest = getProfilesFor(getServerUrl());
        setProfiles(rest);
        if (!rest.length) setStep('auth');
    };

    // ---- step: sign in / register ----
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr('');
        if (mode === 'register' && pw !== pw2) { setErr('Passwords don’t match'); return; }
        if (mode === 'register' && pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
        setBusy(true);
        const res = mode === 'login' ? await loginAccount(email.trim(), pw) : await registerAccount(email.trim(), pw);
        setBusy(false);
        if (!res.ok) { setErr(res.error || 'Something went wrong'); return; }
        if (mode === 'register' && res.recoveryCode) { setSavedCode(res.recoveryCode); setStep('recovery'); return; }
        // signed in — offer to remember this account as an avatar profile
        if (remember) { setStep('avatar'); return; }
        finish();
    };
    const swap = (m: Mode) => { setMode(m); setErr(''); setPw2(''); };

    // ---- step: avatar (after a remembered sign-in) ----
    const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { if (typeof rd.result === 'string') setPickAvatar('upload:' + rd.result); };
        rd.readAsDataURL(f);
    };
    const saveAndFinish = () => { saveProfile(email.trim(), pickAvatar); finish(); };

    // ---- step: reset ----
    const submitReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr('');
        if (pw !== pw2) { setErr('Passwords don’t match'); return; }
        if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
        if (!code.trim()) { setErr('Enter your recovery code'); return; }
        setBusy(true);
        const res = await resetPassword(email.trim(), code.trim(), pw);
        setBusy(false);
        if (!res.ok) { setErr(res.error || 'Could not reset your password'); return; }
        if (res.recoveryCode) { setSavedCode(res.recoveryCode); setStep('recovery'); } else finish();
    };
    const gotoReset = () => { setErr(''); setCode(''); setPw(''); setPw2(''); setStep('reset'); };

    // server dropdown change: pick a detected server, or add a new one
    const onServerChange = (v: string) => {
        if (v === '__add__') { setErr(''); setStep('server'); return; }
        setServerUrl(v); setServerUrlState(v); addKnownServer(v);
        const profs = getProfilesFor(getServerUrl());
        if (profs.length) { setProfiles(profs); setStep('profiles'); }
    };

    const cardCls = 'jpx-account-card' + (exiting ? ' jpx-account-card--exit' : '');

    return (
        <div className='jpx-account-overlay'>
            <div className='jpx-account-aurora' aria-hidden='true'>
                <span className='jpx-account-blob b1' /><span className='jpx-account-blob b2' /><span className='jpx-account-blob b3' />
            </div>

            {step === 'profiles' ? (
                <div className={cardCls}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>Who’s watching?</div>
                    <div className='jpx-account-sub'>Connected to {serverLabel(getServerUrl())}{hasPin() ? ' · PIN required' : ''}</div>
                    {err ? <div className='jpx-account-err'>{err}</div> : null}
                    <div className='jpx-account-profiles'>
                        {profiles.map(p => (
                            <button key={p.id} type='button' className='jpx-account-profile' disabled={busy} onClick={() => pickProfile(p)} title={p.email}>
                                <img className='jpx-account-profile-av' src={renderAvatar(p.avatar)} alt='' />
                                <span className='jpx-account-profile-name'>{p.email}</span>
                                <span className='jpx-account-profile-x' onClick={(e) => forgetProfile(p.id, e)} title='Forget this profile'>×</span>
                            </button>
                        ))}
                        <button type='button' className='jpx-account-profile jpx-account-profile--add' onClick={() => { setMode('login'); setEmail(''); setPw(''); setErr(''); setStep('auth'); }}>
                            <span className='jpx-account-profile-av jpx-account-profile-plus'>＋</span>
                            <span className='jpx-account-profile-name'>Add account</span>
                        </button>
                    </div>
                    <div className='jpx-account-switch'><a onClick={() => { setErr(''); setStep('server'); }}>‹ Use a different server</a></div>
                </div>
            ) : step === 'server' ? (
                <form className={cardCls} onSubmit={connect}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>Connect to your Umbry Server</div>
                    <div className='jpx-account-sub'>Enter the address of your Umbry Server to sync your servers and settings across devices.</div>
                    {err ? <div className='jpx-account-err'>{err}</div> : null}
                    <input className='jpx-account-input' type='text' inputMode='url' placeholder='e.g. 192.168.1.x:8790'
                        value={serverUrl} onChange={e => { setServerUrlState(e.target.value); setDetected(false); }} autoFocus />
                    {detecting ? <div className='jpx-account-detect'>Looking for your Umbry Server…</div>
                        : detected ? <div className='jpx-account-detect jpx-account-detect--found'>✓ Found your Umbry Server — tap Connect</div> : null}
                    <button type='submit' className='jpx-account-submit' disabled={connecting}>{connecting ? '…' : 'Connect'}</button>
                    <div className='jpx-account-switch'><a onClick={useLocal}>Use this device only</a></div>
                </form>
            ) : step === 'avatar' ? (
                <div className={cardCls}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>Pick your avatar</div>
                    <div className='jpx-account-sub'>Next time, just tap it to sign in{hasPin() ? ' (you’ll still enter your PIN)' : ''}.</div>
                    <div className='jpx-account-avgrid'>
                        {AVATAR_PRESETS.map(a => {
                            const val = presetValue(a.id);
                            return <button key={a.id} type='button' className={'jpx-account-avopt' + (pickAvatar === val ? ' is-sel' : '')} onClick={() => setPickAvatar(val)}>
                                <img src={renderAvatar(val)} alt='' />
                            </button>;
                        })}
                        <label className={'jpx-account-avopt jpx-account-avopt--up' + (pickAvatar.startsWith('upload:') ? ' is-sel' : '')} title='Upload your own'>
                            {pickAvatar.startsWith('upload:') ? <img src={renderAvatar(pickAvatar)} alt='' /> : <span>＋</span>}
                            <input type='file' accept='image/*' onChange={onUpload} hidden />
                        </label>
                    </div>
                    <button type='button' className='jpx-account-submit' onClick={saveAndFinish}>Continue</button>
                    <div className='jpx-account-switch'><a onClick={finish}>Skip — don’t save a profile</a></div>
                </div>
            ) : step === 'reset' ? (
                <form className={cardCls} onSubmit={submitReset}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>Reset your password</div>
                    <div className='jpx-account-sub'>Enter your email, the recovery code you saved when you created your account, and a new password.</div>
                    {err ? <div className='jpx-account-err'>{err}</div> : null}
                    <input className='jpx-account-input' type='email' placeholder='Email' value={email} onChange={e => setEmail(e.target.value)} autoComplete='email' autoFocus required />
                    <input className='jpx-account-input' type='text' placeholder='Recovery code' value={code} onChange={e => setCode(e.target.value)} autoCapitalize='characters' spellCheck={false} required />
                    <input className='jpx-account-input' type='password' placeholder='New password' value={pw} onChange={e => setPw(e.target.value)} autoComplete='new-password' required />
                    <input className='jpx-account-input' type='password' placeholder='Confirm new password' value={pw2} onChange={e => setPw2(e.target.value)} autoComplete='new-password' required />
                    <button type='submit' className='jpx-account-submit' disabled={busy}>{busy ? '…' : 'Reset password'}</button>
                    <div className='jpx-account-switch'><a onClick={() => { setErr(''); setStep('auth'); }}>‹ Back to sign in</a></div>
                </form>
            ) : step === 'recovery' ? (
                <div className={cardCls}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>Save your recovery code</div>
                    <div className='jpx-account-sub'>This is the only way to reset your password if you forget it. Keep it somewhere safe — you won’t be shown it again.</div>
                    <div className='jpx-account-code'>{savedCode}</div>
                    <button type='button' className={'jpx-account-copy' + (copied ? ' jpx-account-copy--done' : '')} onClick={copyCode}>{copied ? '✓ Copied to clipboard' : 'Copy code'}</button>
                    <button type='button' className='jpx-account-submit' onClick={() => { if (remember && mode === 'register') { setStep('avatar'); } else { finish(); } }}>I’ve saved it — continue</button>
                </div>
            ) : (
                <form className={cardCls} onSubmit={submit}>
                    <img className='jpx-account-mark' src={jpxMark} alt='' aria-hidden='true' /><img className='jpx-account-logo-img' src={jpxLogo} alt='Umbry' />
                    <div className='jpx-account-title'>{mode === 'login' ? 'Sign in' : 'Create your account'}</div>
                    <div className='jpx-account-sub'>Your servers and settings, on every device.</div>
                    {err ? <div className='jpx-account-err'>{err}</div> : null}

                    {servers.length ? (
                        <select className='jpx-account-input jpx-account-select' value={getServerUrl()} onChange={e => onServerChange(e.target.value)} aria-label='Umbry Server'>
                            {servers.map(s => <option key={s} value={s}>{serverLabel(s)}</option>)}
                            <option value='__add__'>＋ Add another server…</option>
                        </select>
                    ) : null}

                    <input className='jpx-account-input' type='email' placeholder='Email' value={email} onChange={e => setEmail(e.target.value)} autoComplete='email' autoFocus required />
                    <input className='jpx-account-input' type='password' placeholder='Password' value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
                    {mode === 'register' ? <input className='jpx-account-input' type='password' placeholder='Confirm password' value={pw2} onChange={e => setPw2(e.target.value)} autoComplete='new-password' required /> : null}

                    {mode === 'login' ? (
                        <label className='jpx-account-remember'>
                            <input type='checkbox' checked={remember} onChange={e => setRemember(e.target.checked)} />
                            <span>Remember me on this device{hasPin() ? ' — you’ll still enter your PIN to sign in' : ''}</span>
                        </label>
                    ) : null}

                    <button type='submit' className='jpx-account-submit' disabled={busy}>{busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account')}</button>

                    {mode === 'login' ? (
                        <>
                            <div className='jpx-account-hint'>
                                <strong>New to Umbry?</strong> You’ll need an Umbry account to sign in — it’s created on your own Umbry Server (not on the internet) and keeps your settings in sync across devices. If you haven’t made one yet, create it below.
                            </div>
                            <button type='button' className='jpx-account-submit jpx-account-submit--secondary' onClick={() => swap('register')}>Create an account</button>
                            <div className='jpx-account-switch'><a onClick={gotoReset}>Forgot password?</a></div>
                        </>
                    ) : (
                        <button type='button' className='jpx-account-submit jpx-account-submit--secondary' onClick={() => swap('login')}>Already have an account? Sign in</button>
                    )}
                    <div className='jpx-account-switch'><a onClick={() => { setErr(''); setStep('server'); }}>‹ Change server</a></div>
                </form>
            )}
        </div>
    );
}

export function promptJpxAccount(): Promise<void> {
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
        root.render(<AccountScreen onDone={done} />);
    });
}
