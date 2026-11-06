// Umbry — Android TV: most TVs have no web browser, so a link (Settings → Source Code / Help / Rate,
// "Get Umbry Server", Plex sign-in) can't just open a page. On TV, window.open for a web address shows
// the address with a QR code to open it on your phone instead. Plex sign-in keeps polling while the
// dialog is up and closes it once you approve on the phone. TV only (loaded from jpxSpatialNav).
import qrcode from 'qrcode-generator';

import './jpxTvLink.scss';

interface FakeWin { closed: boolean; close: () => void; focus: () => void }

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showLink(url: string): FakeWin {
    const isPlex = /(^|\.)plex\.tv\//i.test(url.replace(/^https?:\/\//i, ''));
    const title = isPlex ? 'Sign in with Plex' : 'Open on your phone';
    const sub = isPlex
        ? 'Scan the code with your phone and sign in to Plex. This screen carries on by itself once you approve.'
        : 'This TV can’t open web pages. Scan the code with your phone’s camera, or go to:';
    let svg = '';
    try {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        svg = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch { /* very long URL: show the address only */ }

    const host = document.createElement('div');
    host.className = 'jpx-tvlink-host';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML =
        '<div class="jpx-tvlink-card">'
        + '<div class="jpx-tvlink-title">' + esc(title) + '</div>'
        + '<div class="jpx-tvlink-sub">' + esc(sub) + '</div>'
        + (svg ? '<div class="jpx-tvlink-qr">' + svg + '</div>' : '')
        + (isPlex ? '' : '<div class="jpx-tvlink-url">' + esc(url.replace(/^https?:\/\//i, '')) + '</div>')
        + '<button type="button" class="jpx-tvlink-close">Close</button>'
        + '</div>';
    document.body.appendChild(host);

    const win: FakeWin = {
        closed: false,
        close: () => { if (!win.closed) { win.closed = true; host.remove(); } },
        focus: () => { /* nothing to focus */ }
    };
    host.querySelector<HTMLButtonElement>('.jpx-tvlink-close')?.addEventListener('click', () => win.close());
    return win;
}

let started = false;
export function initJpxTvLinks(): void {
    if (started) return;
    started = true;
    const nativeOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
        const u = String(url || '');
        if (/^https?:\/\//i.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u)) {
            return showLink(u) as unknown as Window;
        }
        return nativeOpen(url as string, target, features);
    }) as typeof window.open;
}

export default initJpxTvLinks;
