// Imperative recovery-code dialog for Settings. Generates (rotates) a recovery code for the
// signed-in Umbry account and shows it once, reusing the account screen's visual language.
// Call promptRecoveryCode() from the settings action dispatcher and await it.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { accountToken, generateRecoveryCode } from './jpxAccount';
import './jpxAccountPrompt.scss';

function RecoveryScreen({ onDone }: { onDone: () => void }) {
    const [ code, setCode ] = useState('');
    const [ err, setErr ] = useState('');
    const [ busy, setBusy ] = useState(true);
    const [ exiting, setExiting ] = useState(false);
    const [ copied, setCopied ] = useState(false);

    const finish = () => { setExiting(true); setTimeout(onDone, 340); };
    const copyCode = () => { try { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } };

    useEffect(() => {
        if (!accountToken()) {
            setBusy(false);
            setErr('Sign in to your Umbry account first to manage a recovery code.');
            return;
        }
        let cancelled = false;
        generateRecoveryCode().then(res => {
            if (cancelled) return;
            setBusy(false);
            if (res.ok && res.recoveryCode) setCode(res.recoveryCode);
            else setErr(res.error || 'Could not generate a recovery code.');
        });
        return () => { cancelled = true; };
    }, []);

    return (
        <div className='jpx-account-overlay'>
            <div className='jpx-account-aurora' aria-hidden='true'>
                <span className='jpx-account-blob b1' />
                <span className='jpx-account-blob b2' />
                <span className='jpx-account-blob b3' />
            </div>
            <div className={'jpx-account-card' + (exiting ? ' jpx-account-card--exit' : '')}>
                <div className='jpx-account-title'>Password recovery code</div>
                {busy ? (
                    <div className='jpx-account-sub'>Generating…</div>
                ) : err ? (
                    <>
                        <div className='jpx-account-err'>{err}</div>
                        <button type='button' className='jpx-account-submit' onClick={finish}>Close</button>
                    </>
                ) : (
                    <>
                        <div className='jpx-account-sub'>Save this code somewhere safe. It replaces any previous code and is the only way to reset your password if you forget it — you won’t be shown it again.</div>
                        <div className='jpx-account-code'>{code}</div>
                        <button type='button' className={'jpx-account-copy' + (copied ? ' jpx-account-copy--done' : '')} onClick={copyCode}>{copied ? '✓ Copied to clipboard' : 'Copy code'}</button>
                        <button type='button' className='jpx-account-submit' onClick={finish}>Done</button>
                    </>
                )}
            </div>
        </div>
    );
}

export function promptRecoveryCode(): Promise<void> {
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
        root.render(<RecoveryScreen onDone={done} />);
    });
}

export default promptRecoveryCode;
