// Umbry — Additional Ratings (TMDB) on the item detail page (Integrations > Additional Ratings
// + Rating Labels). Fetches the item's TMDB rating by its TMDB provider id and injects a badge into
// the detail page's primary media-info row. Self-contained; reacts to navigation + pref changes.
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { getPref, subscribePrefs } from './jpxPrefs';

const TMDB_KEY = '43843453a040275ba615fe17cd272797';
const cache: Record<string, number | null> = Object.create(null);
let injectTimer = 0;
let lastId = '';

function currentDetailId(): string | null {
    const h = window.location.hash || '';
    if (h.indexOf('details') === -1) return null;
    const m = h.match(/[?&]id=([0-9a-fA-F-]{16,})/);
    return m ? m[1] : null;
}

async function tmdbRating(type: string, tmdbId: string): Promise<number | null> {
    const k = type + ':' + tmdbId;
    if (k in cache) return cache[k];
    const path = (type === 'Series' || type === 'Season' || type === 'Episode') ? 'tv' : 'movie';
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${path}/${tmdbId}?api_key=${TMDB_KEY}`);
        const d = await res.json();
        cache[k] = (d && typeof d.vote_average === 'number' && d.vote_average > 0) ? d.vote_average : null;
    } catch {
        cache[k] = null;
    }
    return cache[k];
}

function removeBadge(): void {
    const b = document.querySelector('.jpx-tmdb-rating');
    if (b && b.parentNode) b.parentNode.removeChild(b);
}

async function inject(): Promise<void> {
    if (!getPref('enableAdditionalRatings', false)) { removeBadge(); return; }
    const id = currentDetailId();
    if (!id) { removeBadge(); return; }
    if (document.querySelector('.jpx-tmdb-rating')) return; // already shown
    // The detail primary-info row holds .mediaInfoItem chips (★ community, critic rating, etc.);
    // inject the TMDB chip as a sibling next to the community-rating star.
    const star = document.querySelector('.starRatingContainer');
    const firstChip = document.querySelector('.mediaInfoItem');
    const anchor = (star && star.parentElement) || (firstChip && firstChip.parentElement);
    if (!anchor) return; // detail not rendered yet — the observer will retry

    const api = (ServerConnections.currentApiClient && ServerConnections.currentApiClient()) as unknown as {
        getCurrentUserId(): string;
        getItem(userId: string, id: string): Promise<{ Type?: string; ProviderIds?: Record<string, string> }>;
    } | undefined;
    if (!api) return;

    let item;
    try { item = await api.getItem(api.getCurrentUserId(), id); } catch { return; }
    const tmdb = item?.ProviderIds?.Tmdb || item?.ProviderIds?.tmdb;
    if (!tmdb) return;
    const rating = await tmdbRating(String(item?.Type), String(tmdb));
    if (rating == null) return;
    if (currentDetailId() !== id || document.querySelector('.jpx-tmdb-rating')) return;

    const badge = document.createElement('div');
    badge.className = 'jpx-tmdb-rating mediaInfoItem';
    const label = getPref('showRatingLabels', true) ? '<span class="jpx-tmdb-label">TMDB</span>' : '';
    badge.innerHTML = `${label}<span class="jpx-tmdb-star">★</span>${rating.toFixed(1)}`;
    anchor.appendChild(badge);
}

function schedule(): void {
    clearTimeout(injectTimer);
    injectTimer = window.setTimeout(() => { void inject(); }, 500);
}

let started = false;
export function initJpxRatings(): void {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', () => { removeBadge(); lastId = ''; schedule(); });
    subscribePrefs(k => { if (k === 'enableAdditionalRatings' || k === 'showRatingLabels') { removeBadge(); schedule(); } });
    const obs = new MutationObserver(() => {
        const id = currentDetailId();
        if (id && (id !== lastId || !document.querySelector('.jpx-tmdb-rating'))) { lastId = id; schedule(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    schedule();
}
