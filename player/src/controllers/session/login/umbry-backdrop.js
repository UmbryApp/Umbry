// Umbry login: randomized TMDB backdrop, centered logo, header-hide, custom forgot-password
import logoUrl from '../../../assets/img/umbry-wordmark.png';
import markUrl from '../../../assets/img/umbry-logo.png';
import Dashboard from '../../../utils/dashboard';
import { ServerConnections } from 'lib/jellyfin-apiclient';
const TMDB_API_KEY = '43843453a040275ba615fe17cd272797';

class BackdropManager {
    constructor(els) { this.backdrops = []; this.currentIndex = -1; this.els = els; }
    async fetchBackdrops() {
        const urls = [
            `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=en-US`,
            `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=en-US&page=1`,
            `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=en-US&page=1`,
            `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&page=1`
        ];
        const results = await Promise.all(urls.map(u => fetch(u).then(r => r.json()).catch(() => ({ results: [] }))));
        const allMovies = results.flatMap(res => res.results || []);
        this.backdrops = [...new Set(allMovies.map(m => m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null).filter(Boolean).sort(() => Math.random() - 0.5))];
    }
    showNext() {
        if (!this.backdrops.length) return;
        this.currentIndex = (this.currentIndex + 1) % this.backdrops.length;
        const url = this.backdrops[this.currentIndex];
        const showEl = (this.currentIndex % 2 === 0) ? this.els[0] : this.els[1];
        const hideEl = (this.currentIndex % 2 === 0) ? this.els[1] : this.els[0];
        const tmp = new Image();
        tmp.onload = () => { showEl.style.backgroundImage = `url('${url}')`; showEl.classList.add('active'); hideEl.classList.remove('active'); };
        tmp.src = url;
    }
    async start() {
        await this.fetchBackdrops(); this.showNext();
        this._t1 = setInterval(() => this.showNext(), 6000);
        this._t2 = setInterval(() => this.fetchBackdrops().then(() => { this.currentIndex = -1; }), 600000);
    }
}

// Injects the shared Umbry auth chrome — the rotating TMDB backdrop + centered wordmark —
// into any standalone auth page (login, server-select, add-server) so they stay consistent.
// The forgot-password button is login-only and self-skips when there's no manual login form.
export function startAuthBackdrop(view) {
    const page = (view && view.id === 'loginPage') ? view : (view.querySelector('#loginPage') || view);

    // A previously-connected server's CustomCss (injected into <head> after login) can paint
    // /Branding/Splashscreen — its OWN logo — as this page's background, which after a Jellyfin
    // login is the Jellyfin logo sitting above our wordmark. That runtime <style> out-cascades our
    // bundled rule, so kill it inline with !important, which beats any stylesheet declaration.
    page.style.setProperty('background', '#0A0718', 'important');
    page.style.setProperty('background-image', 'none', 'important');

    if (page.querySelector('.jpx-auth-aurora')) return;

    // Umbry: animated aurora background (identical to the account sign-in screen) instead of a
    // TMDB movie backdrop, so the account -> server-select flow reads as one continuous screen.
    const aurora = document.createElement('div');
    aurora.className = 'jpx-auth-aurora';
    aurora.innerHTML = '<span class="jpx-auth-blob b1"></span><span class="jpx-auth-blob b2"></span><span class="jpx-auth-blob b3"></span>';
    page.insertBefore(aurora, page.firstChild);

    const content = page.querySelector('.padded-left') || page;
    if (!content.querySelector('.jpx-login-logo')) {
        const wrap = document.createElement('div'); wrap.className = 'jpx-login-logo';
        const mark = document.createElement('img'); mark.className = 'jpx-login-mark'; mark.src = markUrl; mark.alt = '';
        const img = document.createElement('img'); img.src = logoUrl; img.alt = 'Umbry';
        wrap.appendChild(mark); wrap.appendChild(img); content.insertBefore(wrap, content.firstChild);
    }
    // The server-picker card carries its OWN logo (centered-overlay look, like the account screen).
    const ssLogo = page.querySelector('.jpx-ss-logo');
    if (ssLogo && !ssLogo.getAttribute('src')) {
        ssLogo.src = logoUrl;
        if (ssLogo.parentNode && !ssLogo.parentNode.querySelector('.jpx-ss-mark')) {
            const m = document.createElement('img'); m.className = 'jpx-ss-mark'; m.src = markUrl; m.alt = '';
            ssLogo.parentNode.insertBefore(m, ssLogo);
        }
    }

    // Header hiding on the login page is handled entirely in login.scss via
    // `body:has(#loginPage)` — that self-scopes to when the login page is in the
    // DOM and can't leak into the app. (The old JS added a body class that the
    // React app never removed, hiding the toolbar/hamburger app-wide.)

    // forgot-password: clone the Sign In button (identical size/style) -> custom reset page
    const form = page.querySelector('.manualLoginForm');
    if (form && !form.querySelector('.jpx-forgot')) {
        const submit = form.querySelector('.button-submit');
        if (submit) {
            const btn = submit.cloneNode(true);
            btn.classList.add('jpx-forgot');
            btn.setAttribute('type', 'button');
            const span = btn.querySelector('span');
            if (span) span.textContent = 'Forgot Password?';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                // Umbry is a standalone client (possibly public) — it can't reach any one
                // server's reset page and has no account of its own for Jellyfin/Emby users. Point
                // people at the app for whichever server they're signing into, don't navigate away.
                const showResetInfo = (product) => Dashboard.alert({
                    title: 'Reset your password',
                    message: 'To reset your password, please use your ' + product + ' app or the ' + product + ' web portal for this server \u2014 that\u2019s where your account lives. Umbry can\u2019t reset your ' + product + ' password.'
                });
                // Resolve the media server's address robustly — serverAddress() can be empty for a
                // backend-synced server, so also try its serverInfo addresses and window.ApiClient.
                const addrOf = (c) => {
                    if (!c) return '';
                    try { const a = c.serverAddress && c.serverAddress(); if (a) return a; } catch (e1) { /* ignore */ }
                    try { const si = (c.serverInfo && c.serverInfo()) || (c.getServerInfo && c.getServerInfo()); if (si) return si.ManualAddress || si.LocalAddress || si.RemoteAddress || ''; } catch (e2) { /* ignore */ }
                    return '';
                };
                // The URL serverid can be STALE when multiple servers are connected (it may still
                // point at a previously-selected server — e.g. your Jellyfin server while you're on
                // the Emby login), so the ACTIVE window.ApiClient is the reliable source for the
                // server actually being signed into. Fall back to the serverid client only if needed.
                let addr = addrOf(window.ApiClient);
                if (!addr) {
                    try {
                        const q = (location.hash.split('?')[1] || '');
                        const sid = new URLSearchParams(q).get('serverid');
                        if (sid) addr = addrOf(ServerConnections.getOrCreateApiClient(sid));
                    } catch (err) { /* ignore */ }
                }
                // Never GUESS a specific product on failure — a wrong "Jellyfin" is worse than a
                // generic message. Only say Emby/Jellyfin when the probe actually tells us.
                if (!addr) { showResetInfo('Jellyfin or Emby'); return; }
                fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
                    .then((r) => r.ok ? r.json() : null)
                    .then((info) => showResetInfo(!info ? 'Jellyfin or Emby' : (info.ProductName ? 'Jellyfin' : 'Emby')))
                    .catch(() => showResetInfo('Jellyfin or Emby'));
            });
            submit.parentNode.insertBefore(btn, submit.nextSibling);
        }
    }
}

// Back-compat alias — the login controller imports this name.
export const startLoginBackdrop = startAuthBackdrop;
