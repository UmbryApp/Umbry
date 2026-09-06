// Full-screen embedded view of the user's Seerr (Jellyseerr / Overseerr) site, shown inside the
// desktop Player via an Electron <webview>. A webview loads the site as its own top-level document,
// so — unlike an <iframe> — it is not blocked by the site's X-Frame-Options. openSeerrView(url)
// mounts it; the slim top bar reloads, opens externally, or closes.

import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

interface WebviewEl extends HTMLElement { reload: () => void; }

function SeerrView({ url, onClose }: { url: string; onClose: () => void }) {
    const ref = useRef<WebviewEl | null>(null);
    const [ failed, setFailed ] = useState(false);

    useEffect(() => {
        const wv = ref.current;
        if (!wv) return;
        const onFail = (e: Event) => {
            // -3 (ERR_ABORTED) fires on ordinary redirects — not a real failure.
            if ((e as unknown as { errorCode?: number }).errorCode === -3) return;
            setFailed(true);
        };
        const onOk = () => setFailed(false);
        wv.addEventListener('did-fail-load', onFail);
        wv.addEventListener('did-finish-load', onOk);
        return () => {
            wv.removeEventListener('did-fail-load', onFail);
            wv.removeEventListener('did-finish-load', onOk);
        };
    }, []);

    const reload = () => { try { ref.current?.reload(); setFailed(false); } catch { /* ignore */ } };
    const external = () => { try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ } };

    const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,.14)', background: 'transparent', color: '#e7e3f0', cursor: 'pointer' };
    const pillBtn: React.CSSProperties = { padding: '.55em 1.1em', borderRadius: 8, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)', color: '#e7e3f0', cursor: 'pointer' };

    const webviewProps = {
        ref,
        src: url,
        partition: 'persist:umbry-seerr',
        allowpopups: 'true',
        style: { width: '100%', height: '100%', border: 0, display: failed ? 'none' : 'flex' }
    } as unknown as React.ClassAttributes<WebviewEl> & React.HTMLAttributes<WebviewEl>;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#0e0c15', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 46, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(20,18,40,.6)', color: '#e7e3f0' }}>
                <span className='material-icons' style={{ color: '#FF9A4B', fontSize: 20 }} aria-hidden='true'>movie_filter</span>
                <span style={{ fontWeight: 600 }}>Requests</span>
                <span style={{ flex: 1 }} />
                <button type='button' title='Reload' aria-label='Reload' onClick={reload} style={iconBtn}><span className='material-icons' aria-hidden='true'>refresh</span></button>
                <button type='button' title='Open in browser' aria-label='Open in browser' onClick={external} style={iconBtn}><span className='material-icons' aria-hidden='true'>open_in_new</span></button>
                <button type='button' title='Close' aria-label='Close' onClick={onClose} style={iconBtn}><span className='material-icons' aria-hidden='true'>close</span></button>
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                {React.createElement('webview', webviewProps)}
                {failed ? (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: '#c7c3d6', textAlign: 'center', padding: 24 }}>
                        <span className='material-icons' style={{ fontSize: 40, color: '#8a86a0' }} aria-hidden='true'>cloud_off</span>
                        <div>Couldn’t reach<br /><b style={{ color: '#e7e3f0' }}>{url}</b></div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button type='button' onClick={reload} style={pillBtn}>Retry</button>
                            <button type='button' onClick={external} style={pillBtn}>Open in browser</button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function openSeerrView(url: string): void {
    const host = document.createElement('div');
    host.className = 'jpx-seerr-host';
    document.body.appendChild(host);
    let root: Root | null = createRoot(host);
    const close = () => {
        try { root?.unmount(); } catch { /* ignore */ }
        root = null;
        try { host.remove(); } catch { /* ignore */ }
    };
    root.render(<SeerrView url={url} onClose={close} />);
}

export default openSeerrView;
