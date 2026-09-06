import layoutManager from 'components/layoutManager';
import { DEFAULT_SECTIONS, HomeSectionType } from 'constants/homeSectionType';
import { getUserViewsQuery } from 'hooks/api/useUserViews';
import globalize from 'lib/globalize';
import Dashboard from 'utils/dashboard';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { getPref } from 'apps/experimental/theme/jpxPrefs';

import { loadRecordings } from './sections/activeRecordings';
import { loadLibraryButtons } from './sections/libraryButtons';
import { loadLibraryTiles } from './sections/libraryTiles';
import { applyHomeLibraryPrefs } from 'apps/experimental/theme/jpxHomeLibraries';
import { loadLiveTV } from './sections/liveTv';
import { loadNextUp } from './sections/nextUp';
import { loadRecentlyAdded } from './sections/recentlyAdded';
import { loadResume } from './sections/resume';
import { loadJpxHero } from './sections/jpxHero';
import { loadWatchlistRow, loadFavoritesRow, loadCollectionsRow, loadPlaylistsRow, loadGenresRows, loadRewatchRow, loadAudioRow, loadSinceYouWatchedRow, loadResumeMergedRow, loadRecentByType } from './sections/jpxRows';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import './homesections.scss';

const MAX_SECTIONS = 10;
const MAX_SECTIONS_TV = MAX_SECTIONS + 1; // TV layout can have an extra section to ensure a library section is always visible

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function getAllSectionsToShow(userSettings) {
    // Umbry: if the user has configured ANY home section, respect their layout exactly — an
    // unset slot becomes None instead of falling back to the built-in default for that index (which
    // would re-add sections they removed, e.g. Continue Reading / Next Up on a shorter custom list).
    let jpxAnyConfigured = false;
    for (let i = 0; i < MAX_SECTIONS; i++) {
        if (userSettings.get('homesection' + i)) { jpxAnyConfigured = true; break; }
    }
    const sections = [];
    for (let i = 0, length = MAX_SECTIONS; i < length; i++) {
        let section = userSettings.get('homesection' + i) || (jpxAnyConfigured ? HomeSectionType.None : getDefaultSection(i));
        if (section === 'folders') {
            section = getDefaultSection(0);
        }

        sections.push(section);
    }

    // Umbry: drop empty/None slots and collapse duplicate section types. Stock Jellyfin
    // persists all homesection0..N aligned with the defaults, so the `|| getDefaultSection(i)`
    // fallback never re-adds an already-set section. But a partially-configured user (common on
    // Emby, whose display-prefs shape differs) leaves higher slots unset, so the fallback re-adds
    // a section an earlier slot already set — e.g. Latest Media rendered twice. De-dupe by type,
    // preserving first-seen order, so each section type renders exactly once.
    const seen = new Set();
    const uniqueSections = sections.filter((section) => {
        if (!section || section === HomeSectionType.None) return false;
        if (seen.has(section)) return false;
        seen.add(section);
        return true;
    });

    // Umbry: hide Continue Reading / Continue Listening rows in Umbry only. These are
    // filtered from the render, NOT removed from the user's saved Jellyfin/Emby account layout, so
    // other Jellyfin clients are unaffected. Gated by prefs (default hidden) so they can be
    // re-enabled. Plex has no such sections, so this only ever affects Jellyfin/Emby homes.
    const jpxHideResume = [];
    if (getPref('pref_hide_continue_reading', true)) jpxHideResume.push(HomeSectionType.ResumeBook);
    if (getPref('pref_hide_continue_listening', true)) jpxHideResume.push(HomeSectionType.ResumeAudio);
    const filteredSections = jpxHideResume.length
        ? uniqueSections.filter((section) => !jpxHideResume.includes(section))
        : uniqueSections;

    // Ensure libraries are visible in TV layout
    if (
        layoutManager.tv
            && !filteredSections.includes(HomeSectionType.SmallLibraryTiles)
            && !filteredSections.includes(HomeSectionType.LibraryButtons)
    ) {
        return [
            HomeSectionType.SmallLibraryTiles,
            ...filteredSections
        ];
    }

    return filteredSections;
}

// Umbry custom Moonfin home rows, in display order, each gated by its Home Row Toggle
// (jpxPrefs). Rows with no items hide themselves, so an enabled-but-empty row is harmless.
function getJpxCustomRows() {
    const rows = [];
    // Umbry: the audio row duplicated the per-library "Recently Added in Music" row (same
    // content, and mislabeled identically via HeaderLatestMusic="Recently Added Music"), so it
    // appeared as a stray extra music row at the bottom. Removed. (loadAudioRow kept for reference.)
    // if (getPref('pref_display_audio_rows', false)) rows.push(loadAudioRow);
    // Umbry: Collections now live inside the library (default tab), not as a home row.
    // Watchlist row first among the custom rows; it auto-hides when empty.
    if (getPref('pref_display_watchlist_row', true)) rows.push(loadWatchlistRow);
    // Collections were moved into the library's default tab, but the "Display Collections Rows"
    // toggle can still surface them as a Home row (was previously a no-op).
    if (getPref('pref_display_collections_rows', false)) rows.push(loadCollectionsRow);
    if (getPref('pref_display_favorites_rows', false)) rows.push(loadFavoritesRow);
    if (getPref('pref_display_genres_rows', false)) rows.push(loadGenresRows);
    if (getPref('pref_display_playlists_rows', false)) rows.push(loadPlaylistsRow);
    if (getPref('pref_display_rewatch_row', false)) rows.push(loadRewatchRow);
    if (getPref('pref_display_since_you_watched_rows', false)) rows.push(loadSinceYouWatchedRow);
    return rows;
}

export function loadSections(elem, apiClient, user, userSettings) {
    const userId = user.Id || apiClient.getCurrentUserId();
    return queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), { userId }))
        .then(result => (result && result.Items) || [])
        .then(applyHomeLibraryPrefs)
        .then(function (userViews) {
            let html = '';

            if (userViews.length) {
                // TV layout can have an extra section to ensure libraries are visible
                const totalSectionCount = layoutManager.tv ? MAX_SECTIONS_TV : MAX_SECTIONS;

                // Umbry: cinematic featured hero at the top of Home (skip TV layout).
                if (!layoutManager.tv) {
                    html += '<div class="jpx-hero"></div>';
                }

                for (let i = 0; i < totalSectionCount; i++) {
                    html += '<div class="verticalSection section' + i + '"></div>';
                }

                // Umbry: custom Moonfin rows after the default sections.
                const jpxRows = getJpxCustomRows();
                for (let k = 0; k < jpxRows.length; k++) {
                    html += '<div class="verticalSection jpxCustomSection jpxCustomSection' + k + '"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');

                if (!layoutManager.tv) {
                    const heroEl = elem.querySelector('.jpx-hero');
                    if (heroEl) loadJpxHero(heroEl, apiClient, user);
                }

                const promises = getAllSectionsToShow(userSettings)
                    .map((section, index) => (
                        loadSection(elem, apiClient, user, userSettings, userViews, section, index)
                    ));

                // Umbry: load the enabled custom rows into their containers.
                const jpxOptions = { enableOverflow: enableScrollX() };
                jpxRows.forEach((loadRow, k) => {
                    const rowElem = elem.querySelector('.jpxCustomSection' + k);
                    if (rowElem) promises.push(Promise.resolve(loadRow(rowElem, apiClient, user, jpxOptions)));
                });

                return Promise.all(promises)
                    // Timeout for polyfilled CustomElements (webOS 1.2)
                    .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
                    .then(() => resume(elem, { refresh: true }));
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        });
}

export function destroySections(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

export function resume(elem, options) {
    const elems = elem.querySelectorAll('.itemsContainer');
    const promises = [];

    Array.prototype.forEach.call(elems, section => {
        if (section.resume) {
            promises.push(section.resume(options));
        }
    });

    return Promise.all(promises);
}

function loadSection(page, apiClient, user, userSettings, userViews, section, index) {
    const elem = page.querySelector('.section' + index);
    const options = { enableOverflow: enableScrollX() };

    switch (section) {
        case HomeSectionType.ActiveRecordings:
            loadRecordings(elem, true, apiClient, options);
            break;
        case HomeSectionType.LatestMedia:
            // Umbry: optionally group "Recently Added" by media type instead of per library.
            if (getPref('pref_merge_recent_rows_by_type', false)) {
                loadRecentByType(elem, apiClient, user, options);
            } else {
                loadRecentlyAdded(elem, apiClient, user, userViews, options);
            }
            break;
        case HomeSectionType.LibraryButtons:
            return loadLibraryButtons(elem, userViews);
        case HomeSectionType.LiveTv:
            return loadLiveTV(elem, apiClient, user, options);
        case HomeSectionType.NextUp:
            // Umbry: when Continue Watching + Next Up are merged, the merged row carries Next Up.
            if (getPref('pref_merge_continue_watching_next_up', false)) { elem.innerHTML = ''; break; }
            loadNextUp(elem, apiClient, userSettings, options);
            break;
        case HomeSectionType.Resume:
            if (getPref('pref_merge_continue_watching_next_up', false)) {
                loadResumeMergedRow(elem, apiClient, user, options);
            } else {
                loadResume(elem, apiClient, 'HeaderContinueWatching', 'Video', userSettings, options);
            }
            break;
        case HomeSectionType.ResumeAudio:
            loadResume(elem, apiClient, 'HeaderContinueListening', 'Audio', userSettings, options);
            break;
        case HomeSectionType.ResumeBook:
            loadResume(elem, apiClient, 'HeaderContinueReading', 'Book', userSettings, options);
            break;
        case HomeSectionType.SmallLibraryTiles:
            return loadLibraryTiles(elem, userViews, options);
        default:
            elem.innerHTML = '';
    }

    return Promise.resolve();
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};
