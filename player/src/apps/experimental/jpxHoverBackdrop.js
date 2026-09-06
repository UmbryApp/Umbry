// Umbry — Moonfin-style hover backdrop. Hovering any card blurs that item's backdrop
// across the page background (two crossfading layers), fading out when you leave the cards.
// Also drives the card hover media preview (Local Previews > Media Preview + Preview Audio):
// after a short dwell, the item's trailer plays over the card image (muted unless Preview Audio).
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { getPref } from './theme/jpxPrefs';
import { makeTrailerEl } from './theme/jpxTrailer';

import './jpxHoverBackdrop.scss';

let layers = null;
let activeLayer = 0;
let currentId = null;
let hideTimer = null;
let inited = false;

// ---- card hover media preview state ----
let previewTimer = null;
let previewCard = null;

function ensureLayers() {
    if (layers) return layers;
    // Insert into <body> before #reactRoot so React never reconciles them away,
    // and they paint behind the (now transparent) app content.
    const reactRoot = document.getElementById('reactRoot');
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.className = 'jpx-hoverbg';
    b.className = 'jpx-hoverbg';
    if (reactRoot && reactRoot.parentNode) {
        reactRoot.parentNode.insertBefore(b, reactRoot);
        reactRoot.parentNode.insertBefore(a, reactRoot);
    } else {
        document.body.appendChild(b);
        document.body.appendChild(a);
    }
    layers = [a, b];
    return layers;
}

function cardIdFrom(el) {
    if (!el || !el.closest) return null;
    const card = el.closest('.card');
    if (!card) return null;
    // Skip the pre-login flow (server-/user-select): those cards carry server/entity
    // GUIDs, not library item IDs, so morphing them just fires bogus image requests.
    if (card.closest('#loginPage')) return null;
    const withId = card.getAttribute('data-id') ? card : card.querySelector('[data-id]');
    return withId ? withId.getAttribute('data-id') : null;
}

function show(id) {
    if (id === currentId) return;
    currentId = id;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient) return;

    // Umbry: Plex uses a different image API, so resolve the item's backdrop URL from Plex
    // (the item carries a ready-made __backdropUrl) instead of building a Jellyfin image path.
    if (String(id).indexOf('plex_') === 0) {
        Promise.resolve(apiClient.getItem(apiClient.getCurrentUserId(), id)).then((it) => {
            if (currentId !== id || !it) return;
            const purl = it.__backdropUrl || it.__primaryImageUrl;
            if (!purl) return;
            const pimg = new Image();
            pimg.onload = () => {
                if (currentId !== id) return;
                const [a, b] = ensureLayers();
                const next = activeLayer ^ 1;
                const incoming = next ? b : a;
                const outgoing = next ? a : b;
                incoming.style.backgroundImage = "url('" + purl + "')";
                incoming.classList.add('active');
                outgoing.classList.remove('active');
                activeLayer = next;
            };
            pimg.src = purl;
        }).catch(() => { /* ignore */ });
        return;
    }

    const url = apiClient.getUrl('Items/' + id + '/Images/Backdrop/0', { maxWidth: 1280, quality: 80 });

    const img = new Image();
    img.onload = () => {
        if (currentId !== id) return;
        const [a, b] = ensureLayers();
        const next = activeLayer ^ 1;
        const incoming = next ? b : a;
        const outgoing = next ? a : b;
        incoming.style.backgroundImage = "url('" + url + "')";
        incoming.classList.add('active');
        outgoing.classList.remove('active');
        activeLayer = next;
    };
    img.src = url;
}

function hide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        currentId = null;
        const [a, b] = ensureLayers();
        a.classList.remove('active');
        b.classList.remove('active');
    }, 450);
}

function removePreview() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    const ex = document.querySelector('.jpx-card-preview');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    if (previewCard) { previewCard.classList.remove('jpx-previewing'); previewCard = null; }
}

function schedulePreview(card, id) {
    // Umbry: the card-hover thumb must stay the movie's still image — NEVER a trailer overlay
    // (it covered the thumb and broke the morph). Card trailer previews are disabled outright.
    return;
    // eslint-disable-next-line no-unreachable
    if (!getPref('episodePreviewEnabled', false)) return;
    if (previewCard === card) return;
    removePreview();
    previewCard = card;
    previewTimer = setTimeout(() => {
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient) return;
        Promise.resolve(apiClient.getItem(apiClient.getCurrentUserId(), id)).then(item => {
            if (previewCard !== card || !card.isConnected) return null;
            const muted = !getPref('previewAudioEnabled', false);
            return makeTrailerEl(apiClient, item, 'jpx-card-preview', muted).then(el => {
                if (!el || previewCard !== card || !card.isConnected) return;
                const imgc = card.querySelector('.cardImageContainer') || card.querySelector('.cardImage') || card;
                if (getComputedStyle(imgc).position === 'static') imgc.style.position = 'relative';
                card.classList.add('jpx-previewing');
                imgc.appendChild(el);
            });
        }).catch(() => { /* no trailer / fetch failed */ });
    }, 1200);
}

export function initJpxHoverBackdrop() {
    if (inited) return;
    inited = true;

    // Hover-only effect (background blur + card preview) — skip on touch / no-hover devices, where
    // mouseout never fires and a card preview / morph could get stuck.
    const noHover = typeof window !== 'undefined' && window.matchMedia
        && (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches);
    if (noHover) return;

    ensureLayers();

    document.addEventListener('mouseover', (e) => {
        const card = e.target && e.target.closest && e.target.closest('.card');
        const id = cardIdFrom(e.target);
        if (id) { show(id); if (card && !card.closest('#loginPage')) schedulePreview(card, id); }
    });

    document.addEventListener('mouseout', (e) => {
        const leavingCard = e.target && e.target.closest && e.target.closest('.card');
        const enteringCard = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.card');
        if (leavingCard && !enteringCard) { hide(); removePreview(); }
    });
}

export default initJpxHoverBackdrop;
