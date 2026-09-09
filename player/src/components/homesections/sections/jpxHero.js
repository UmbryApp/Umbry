// Umbry home hero — cinematic featured "media bar" (Moonfin-inspired).
// Rotates through several recently-added titles with a crossfading backdrop,
// logo-or-title, metadata, overview, Play / More Info actions, and position dots.
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { getPref } from 'apps/experimental/theme/jpxPrefs';
import { makeTrailerEl } from 'apps/experimental/theme/jpxTrailer';

import './jpxHero.scss';

const BACKDROP_MAX_WIDTH = 1920;
const LOGO_MAX_WIDTH = 600;
const CANDIDATE_LIMIT = 30;
const MAX_FEATURED = 7;
const ROTATE_MS = 9000;
const MAX_TRAILER_MS = 90000; // max time to hold a slide while its trailer plays (fallback)

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function runtimeText(ticks) {
    const mins = Math.round(ticks / 600000000);
    if (mins <= 0) return null;
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

function buildMeta(item) {
    const bits = [];
    if (item.ProductionYear) bits.push(esc(item.ProductionYear));
    if (item.OfficialRating) bits.push('<span class="jpx-hero-rating">' + esc(item.OfficialRating) + '</span>');
    const rt = item.RunTimeTicks ? runtimeText(item.RunTimeTicks) : null;
    if (rt) bits.push(esc(rt));
    if (item.CommunityRating) bits.push('★ ' + item.CommunityRating.toFixed(1));
    if (item.Genres && item.Genres.length) bits.push(esc(item.Genres.slice(0, 3).join(' · ')));
    return bits.join('<i class="jpx-hero-dot"></i>');
}

function hasBackdrop(item) {
    return item.BackdropImageTags && item.BackdropImageTags.length;
}

function contentHtml(apiClient, item) {
    const logoTag = item.ImageTags && item.ImageTags.Logo;
    const logoUrl = logoTag
        ? apiClient.getScaledImageUrl(item.Id, { type: 'Logo', maxWidth: LOGO_MAX_WIDTH, tag: logoTag })
        : null;
    const heading = logoUrl
        ? '<img class="jpx-hero-logo" src="' + logoUrl + '" alt="' + esc(item.Name) + '" />'
        : '<h1 class="jpx-hero-title">' + esc(item.Name) + '</h1>';
    const overview = item.Overview
        ? '<p class="jpx-hero-overview">' + esc(item.Overview) + '</p>' : '';

    return heading
        + '<div class="jpx-hero-card">'
        + '<div class="jpx-hero-meta">' + buildMeta(item) + '</div>'
        + overview
        + '</div>'
        + '<div class="jpx-hero-actions">'
        + '<button is="emby-button" type="button" class="jpx-hero-btn jpx-hero-play">'
        + '<span class="material-icons" aria-hidden="true">play_arrow</span><span>Play</span></button>'
        + '<button is="emby-button" type="button" class="jpx-hero-btn jpx-hero-info">'
        + '<span class="material-icons" aria-hidden="true">info</span><span>More Info</span></button>'
        + '</div>';
}

export function loadJpxHero(elem, apiClient, user) {
    const userId = user.Id || apiClient.getCurrentUserId();

    // Driven by Settings › Personalization › Media Bar (jpxPrefs).
    const contentType = getPref('mediaBarContentType', 'both');
    const includeTypes = contentType === 'movies' ? 'Movie' : contentType === 'shows' ? 'Series' : 'Movie,Series';
    const sourceType = getPref('mediaBarSourceType', 'random');
    const sortBy = sourceType === 'random' ? 'Random'
        : sourceType === 'recentlyReleased' ? 'PremiereDate,ProductionYear'
            : 'DateCreated';
    const maxFeatured = Math.max(1, Math.min(20, Number(getPref('mediaBarItemCount', MAX_FEATURED)) || MAX_FEATURED));
    const autoAdvance = getPref('mediaBarAutoAdvance', true);

    return apiClient.getItems(userId, {
        SortBy: sortBy,
        SortOrder: 'Descending',
        IncludeItemTypes: includeTypes,
        Recursive: true,
        Limit: CANDIDATE_LIMIT,
        Fields: 'Overview,Genres,RemoteTrailers,LocalTrailerCount,ProductionYear,OfficialRating,CommunityRating',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Backdrop,Logo,Primary'
    }).then(result => {
        const featured = (result.Items || []).filter(hasBackdrop).slice(0, maxFeatured);
        if (!featured.length) {
            elem.classList.add('jpx-hero--empty');
            return;
        }

        elem.innerHTML =
            '<div class="jpx-hero-backdrop jpx-hero-bd-a"></div>'
            + '<div class="jpx-hero-backdrop jpx-hero-bd-b"></div>'
            + '<div class="jpx-hero-scrim"></div>'
            + '<div class="jpx-hero-content"></div>'
            + '<div class="jpx-hero-dots"></div>';

        const bd = [elem.querySelector('.jpx-hero-bd-a'), elem.querySelector('.jpx-hero-bd-b')];
        const contentEl = elem.querySelector('.jpx-hero-content');
        const dotsEl = elem.querySelector('.jpx-hero-dots');
        dotsEl.innerHTML = featured.map((_, i) =>
            '<button class="jpx-hero-nav-dot" data-i="' + i + '" aria-label="Featured ' + (i + 1) + '"></button>'
        ).join('');
        const navDots = Array.from(dotsEl.querySelectorAll('.jpx-hero-nav-dot'));

        let current = -1;
        let bdLayer = 0;
        let paused = false;
        let trailerTimer = null;
        let advTimer = null;

        // Per-slide rotation scheduler. A playing trailer reschedules this to MAX_TRAILER_MS and, on
        // end, advances immediately — so a trailer is never cut off after a few seconds.
        const scheduleAdvance = (ms) => {
            if (advTimer) { clearTimeout(advTimer); advTimer = null; }
            if (!autoAdvance || featured.length < 2) return;
            advTimer = setTimeout(() => {
                if (!elem.isConnected) return;
                if (paused) { scheduleAdvance(1500); return; } // hovered -> retry shortly
                show((current + 1) % featured.length);
            }, ms);
        };

        const show = (index) => {
            if (index === current) return;
            current = index;
            const item = featured[index];
            elem.classList.remove('jpx-hero--trailer'); // reset trailer-mode (synopsis/logo) for the new slide

            // Umbry: clear any playing trailer from the previous slide.
            clearTimeout(trailerTimer);
            const oldTrailer = elem.querySelector('.jpx-hero-trailer');
            if (oldTrailer) oldTrailer.remove();

            // crossfade backdrop
            const nextLayer = bdLayer ^ 1;
            const url = apiClient.getScaledImageUrl(item.Id, {
                type: 'Backdrop', maxWidth: BACKDROP_MAX_WIDTH, tag: item.BackdropImageTags[0]
            });
            const img = new Image();
            img.onload = () => {
                bd[nextLayer].style.backgroundImage = "url('" + url + "')";
                bd[nextLayer].classList.add('active');
                bd[bdLayer].classList.remove('active');
                bdLayer = nextLayer;
            };
            img.src = url;

            // swap content with a quick fade
            contentEl.classList.remove('jpx-hero-content--in');
            contentEl.innerHTML = contentHtml(apiClient, item);
            // force reflow so the fade re-triggers
            void contentEl.offsetWidth;
            contentEl.classList.add('jpx-hero-content--in');

            contentEl.querySelector('.jpx-hero-play').addEventListener('click', () => {
                playbackManager.play({ ids: [item.Id], serverId: item.ServerId || apiClient.serverId() })
                    .catch(err => console.error('[jpxHero] play failed', err));
            });
            contentEl.querySelector('.jpx-hero-info').addEventListener('click', () => {
                appRouter.showItem(item);
            });

            navDots.forEach((d, i) => d.classList.toggle('active', i === index));
            elem.classList.add('jpx-hero--ready');

            // Umbry: schedule this slide's rotation (a trailer, once it starts, extends it).
            scheduleAdvance(ROTATE_MS);

            // Umbry: Media Bar > Trailer Preview — play the item's trailer behind the hero after a
            // beat (muted unless Trailer Audio is on). While it plays: hide the synopsis, shrink the
            // logo (via the jpx-hero--trailer class), and hold this slide until the trailer ends.
            if (getPref('mediaBarTrailerPreview', true)) {
                trailerTimer = setTimeout(async () => {
                    if (current !== index || !elem.isConnected) return;
                    scheduleAdvance(MAX_TRAILER_MS); // hold the slide while the trailer loads + plays
                    const muted = !getPref('mediaBarTrailerAudio', false);
                    // Plex items have no Jellyfin RemoteTrailers/LocalTrailers — resolve the Plex
                    // trailer extra (a direct MP4) so Plex gets a hero trailer too.
                    if (item.__plexServerId && !item.__trailerUrl && typeof apiClient.getTrailerUrl === 'function') {
                        try { const u = await apiClient.getTrailerUrl(item.Id); if (u) item.__trailerUrl = u; } catch (e) { /* ignore */ }
                        if (current !== index || !elem.isConnected) return;
                    }
                    makeTrailerEl(apiClient, item, 'jpx-hero-trailer', muted, {
                        loop: false,
                        onPlaying: () => { if (current === index) elem.classList.add('jpx-hero--trailer'); },
                        onEnded: () => { if (current === index) show((current + 1) % featured.length); }
                    }).then(el => {
                        if (!el) { if (current === index) scheduleAdvance(ROTATE_MS); return; } // no trailer -> normal rotation
                        if (current !== index || !elem.isConnected) return;
                        elem.insertBefore(el, elem.querySelector('.jpx-hero-scrim'));
                    });
                }, 2200);
            }
        };

        show(0);

        // Umbry mobile: swipe left/right across the hero to change the featured slide.
        let lastSwipe = 0;
        if (featured.length > 1) {
            let sx = 0, sy = 0, st = 0;
            elem.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
            elem.addEventListener('touchend', (e) => {
                const t = e.changedTouches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
                if (Date.now() - st < 600 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    lastSwipe = Date.now();
                    if (dx < 0) show((current + 1) % featured.length);
                    else show((current - 1 + featured.length) % featured.length);
                }
            }, { passive: true });
        }

        // Umbry: the whole hero (backdrop + frosted card) is clickable -> open the featured
        // item's detail page. jpx-hero clickable. Play / More Info / dots keep their own actions.
        elem.addEventListener('click', (e) => {
            if (e.target.closest('.jpx-hero-actions, .jpx-hero-dots, button')) return;
            if (Date.now() - lastSwipe < 400) return; // a swipe just changed slides — don't also navigate
            const featuredItem = featured[current];
            if (featuredItem) appRouter.showItem(featuredItem);
        });

        // Rotation is scheduled per-slide inside show() via scheduleAdvance() — a playing trailer
        // extends it and advances on end, so trailers play in full instead of being cut off.

        // pause on hover, jump on dot click
        elem.addEventListener('mouseenter', () => { paused = true; });
        elem.addEventListener('mouseleave', () => { paused = false; });
        navDots.forEach(dot => dot.addEventListener('click', () => {
            show(parseInt(dot.getAttribute('data-i'), 10));
        }));
    }).catch(err => {
        console.error('[jpxHero] failed to load featured item', err);
        elem.classList.add('jpx-hero--empty');
    });
}

export default loadJpxHero;
