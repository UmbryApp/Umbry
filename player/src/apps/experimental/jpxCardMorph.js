// Umbry — Moonfin-style in-flow card morph. Hovering an item card expands it into a
// landscape thumb/backdrop card (in-flow: neighbors reflow) and floats a title/metadata/synopsis
// panel anchored right below it — overlapping into the gap the way Moonfin does.
//
// Works for both the legacy home cards (background-image) and the experimental library cards
// (which render an <img>): we set the container background to the thumb and hide the <img> via
// CSS, re-applying the background each frame so a React re-render can't undo it.
import { ServerConnections } from 'lib/jellyfin-apiclient';

import './jpxCardMorph.scss';

const ENTER_DELAY = 150;
let current = null;
let enterTimer = null;
let raf = null;
let panelEl = null;
let inited = false;
let curImgc = null;
let curImgUrl = null;
const infoCache = {};

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cardFrom(el) {
    if (!el || !el.closest) return null;
    const card = el.closest('.card');
    if (!card || !card.getAttribute('data-id')) return null;
    // Skip the pre-login flow (server-/user-select): those cards carry server/entity
    // GUIDs, not library item IDs, so morphing them just fires bogus image requests.
    if (card.closest('#loginPage')) return null;
    // Umbry: skip the morph for Plex items — its getInfo() fetches Jellyfin item/image data that
    // 404s on Plex (it only logged errors and never rendered there).
    return card;
}

function runtimeText(ticks) {
    const m = Math.round(ticks / 600000000);
    if (m <= 0) return null;
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
}

function scaledUrl(apiClient, itemId, type, tag) {
    return apiClient.getScaledImageUrl(itemId, { type: type, maxWidth: 700, tag: tag });
}

function getInfo(apiClient, id) {
    if (infoCache[id]) return Promise.resolve(infoCache[id]);
    return apiClient.getItem(apiClient.getCurrentUserId(), id).then(item => {
        const isEpisode = item.Type === 'Episode';
        const tags = item.ImageTags || {};
        const meta = [];
        if (isEpisode && item.ParentIndexNumber != null && item.IndexNumber != null) {
            meta.push('S' + item.ParentIndexNumber + ':E' + item.IndexNumber);
        }
        if (item.ProductionYear) meta.push(item.ProductionYear);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        const rt = item.RunTimeTicks ? runtimeText(item.RunTimeTicks) : null;
        if (rt) meta.push(rt);
        if (item.CommunityRating) meta.push('★ ' + item.CommunityRating.toFixed(1));
        if (!isEpisode && item.Genres && item.Genres.length) meta.push(item.Genres.slice(0, 3).join(' · '));

        // Landscape image chain: own Thumb -> parent (series) Thumb -> own Backdrop
        // -> parent Backdrop -> own Primary (episode screenshots are landscape Primaries).
        let url = null;
        if (item.__backdropUrl) {
            url = item.__backdropUrl;
        } else if (tags.Thumb) {
            url = scaledUrl(apiClient, id, 'Thumb', tags.Thumb);
        } else if (item.ParentThumbItemId && item.ParentThumbImageTag) {
            url = scaledUrl(apiClient, item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag);
        } else if (item.BackdropImageTags && item.BackdropImageTags.length) {
            url = scaledUrl(apiClient, id, 'Backdrop', item.BackdropImageTags[0]);
        } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
            url = scaledUrl(apiClient, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0]);
        } else if (tags.Primary) {
            url = scaledUrl(apiClient, id, 'Primary', tags.Primary);
        }

        const info = {
            name: (isEpisode ? item.SeriesName : item.Name) || item.Name || '',
            meta: meta.join('  ·  '),
            overview: (item.Overview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            imageUrl: url
        };
        infoCache[id] = info;
        return info;
    });
}

function ensurePanel() {
    if (panelEl && panelEl.isConnected) return panelEl;
    panelEl = document.createElement('div');
    panelEl.className = 'jpx-morph-panel';
    document.body.appendChild(panelEl);
    return panelEl;
}

function applyImage() {
    if (!curImgc || !curImgUrl) return;
    const want = "url(\"" + curImgUrl + "\")";
    // re-apply only if something reset it (cheap idempotent guard)
    if (curImgc.style.backgroundImage.indexOf(curImgUrl) === -1) {
        curImgc.style.backgroundImage = want;
    }
    curImgc.style.backgroundSize = 'cover';
    curImgc.style.backgroundPosition = 'center';
}

function positionPanel(card) {
    const p = ensurePanel();
    // Anchor to the bordered .cardBox (not the inner image) so the panel's width/left line up with
    // the card's accent border exactly — otherwise the side borders step at the seam.
    const anchor = card.querySelector('.cardBox')
        || card.querySelector('.cardImageContainer')
        || card.querySelector('.cardScalable') || card;
    const r = anchor.getBoundingClientRect();
    // If the card was removed (navigation / SPA re-render / tab switch), its rect collapses to
    // zeros and the panel would snap to the top-left corner and stick there (the purple sliver).
    // Bail so the caller can tear the morph down instead.
    if (!card.isConnected || (r.width === 0 && r.height === 0)) return false;
    // Account for any page zoom (UI Scaling): the panel lives inside the zoomed <body>, so its
    // fixed left/top/width must be divided by the zoom factor to line up with the anchor's rect.
    var Z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    p.style.left = (r.left / Z) + 'px';
    // Overlap the card's bottom by 2px so the card's side borders and the panel's side borders meet.
    p.style.top = ((r.bottom - 2) / Z) + 'px';
    p.style.width = (r.width / Z) + 'px';
    return true;
}

function startTracking(card) {
    if (raf) cancelAnimationFrame(raf);
    const loop = () => {
        if (current !== card) { raf = null; return; }
        if (!card.isConnected) { unmorph(card); current = null; raf = null; return; }
        applyImage();
        if (!positionPanel(card)) { unmorph(card); current = null; raf = null; return; }
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
}

function morph(card, id) {
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient) return;
    getInfo(apiClient, id).then(info => {
        if (current !== card || !info.imageUrl) return;

        const imgc = card.querySelector('.cardImageContainer');
        if (imgc) {
            if (imgc.dataset.jpxOrigBg === undefined) {
                imgc.dataset.jpxOrigBg = imgc.style.backgroundImage || '';
            }
            curImgc = imgc;
            curImgUrl = info.imageUrl;
        }

        const p = ensurePanel();
        p.innerHTML =
            '<div class="jpx-morph-title">' + esc(info.name) + '</div>'
            + (info.meta ? '<div class="jpx-morph-meta">' + esc(info.meta) + '</div>' : '')
            + (info.overview ? '<div class="jpx-morph-overview">' + esc(info.overview) + '</div>' : '');

        card.classList.add('jpx-morph');
        applyImage();
        positionPanel(card);
        p.classList.add('active');
        startTracking(card);
    }).catch(err => console.error('[jpxCardMorph]', err));
}

function unmorph(card) {
    if (!card) return;
    card.classList.remove('jpx-morph');
    const imgc = card.querySelector('.cardImageContainer');
    if (imgc) {
        if (imgc.dataset.jpxOrigBg !== undefined) {
            imgc.style.backgroundImage = imgc.dataset.jpxOrigBg;
        }
        imgc.style.backgroundSize = '';
        imgc.style.backgroundPosition = '';
    }
    curImgc = null;
    curImgUrl = null;
    if (panelEl) panelEl.classList.remove('active');
    if (raf) { cancelAnimationFrame(raf); raf = null; }
}

export function initJpxCardMorph() {
    if (inited) return;
    inited = true;

    // Always tear down any active morph/panel on navigation or touch — on touch devices mouseout
    // never fires, which would leave the panel stuck (a purple-edged sliver at the top-left).
    const jpxCleanup = () => {
        if (current) unmorph(current);
        current = null;
        clearTimeout(enterTimer);
        if (panelEl) panelEl.classList.remove('active');
    };
    window.addEventListener('hashchange', jpxCleanup);
    window.addEventListener('popstate', jpxCleanup);
    document.addEventListener('touchstart', jpxCleanup, { passive: true });
    // Desktop: clicking a card navigates without always firing hashchange/popstate; clean up then too.
    document.addEventListener('click', jpxCleanup, true);

    // The expand-on-hover affordance needs a real pointer; skip it on touch / no-hover devices
    // (it can't be used there and only causes the stuck-panel artifact).
    const noHover = typeof window !== 'undefined' && window.matchMedia
        && (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches);
    if (noHover) return;

    document.addEventListener('mouseover', (e) => {
        const card = cardFrom(e.target);
        if (!card || card === current) return;
        if (current) unmorph(current);
        current = card;
        const id = card.getAttribute('data-id');
        clearTimeout(enterTimer);
        enterTimer = setTimeout(() => { if (current === card) morph(card, id); }, ENTER_DELAY);
    });

    document.addEventListener('mouseout', (e) => {
        const card = cardFrom(e.target);
        const entering = cardFrom(e.relatedTarget);
        if (card && card === current && entering !== card) {
            clearTimeout(enterTimer);
            unmorph(card);
            current = null;
        }
    });
}

export default initJpxCardMorph;
