// Umbry custom Home rows (Moonfin). Each row is gated by a jpxPrefs toggle in
// homesections.js (the "Home Row Toggles" settings panel). Mirrors the stock section
// pattern: a title + emby-scroller + emby-itemscontainer, with fetchData/getItemsHtml set
// on the container. The container normalizes the fetch result ({ Items } -> array) and
// auto-reveals the row only when it has items (via the `hide` class on parentContainer).
import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getBackdropShape, getPortraitShape, getSquareShape } from 'components/cardbuilder/utils/shape';
import globalize from 'lib/globalize';
import { watchlistIdsForServer } from 'apps/experimental/theme/jpxWatchlist';

const IMG_FIELDS = 'PrimaryImageAspectRatio';

function buildRow(elem, title, options, fetchFn, htmlFn, dataMonitor) {
    let html = '';
    html += '<h2 class="sectionTitle sectionTitle-cards padded-left">' + title + '</h2>';
    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x" data-monitor="' + (dataMonitor || 'markfavorite,markplayed') + '">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x" data-monitor="' + (dataMonitor || 'markfavorite,markplayed') + '">';
    }
    if (options.enableOverflow) html += '</div>';
    html += '</div>';

    elem.classList.add('hide');
    elem.innerHTML = html;

    const container = elem.querySelector('.itemsContainer');
    if (!container) return;
    container.fetchData = fetchFn;
    container.getItemsHtml = htmlFn;
    container.parentContainer = elem;
}

function cardHtmlFn(shape, extra) {
    return function (items) {
        return cardBuilder.getCardsHtml(Object.assign({
            items: items,
            shape: shape,
            context: 'home',
            showTitle: true,
            centerText: true,
            overlayText: false,
            lazy: true,
            overlayPlayButton: true,
            showYear: true,
            cardLayout: false,
            lines: 2
        }, extra || {}));
    };
}

export function loadWatchlistRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    const serverId = (apiClient.serverId && apiClient.serverId()) || '';
    const ids = watchlistIdsForServer(serverId);
    buildRow(elem, 'My Watchlist', options,
        function () {
            if (!ids.length) return Promise.resolve({ Items: [] });
            return apiClient.getItems(userId, {
                Ids: ids.join(','), Fields: IMG_FIELDS,
                EnableTotalRecordCount: false, Limit: 60
            });
        },
        cardHtmlFn(getPortraitShape(options.enableOverflow)));
    return Promise.resolve();
}

export function loadFavoritesRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, globalize.translate('Favorites'), options,
        function () {
            return apiClient.getItems(userId, {
                SortBy: 'SeriesSortName,SortName', SortOrder: 'Ascending',
                Filters: 'IsFavorite', Recursive: true, Fields: IMG_FIELDS,
                CollapseBoxSetItems: false, ExcludeLocationTypes: 'Virtual',
                EnableTotalRecordCount: false, Limit: 20,
                IncludeItemTypes: 'Movie,Series,MusicAlbum'
            });
        },
        cardHtmlFn(getPortraitShape(options.enableOverflow)));
    return Promise.resolve();
}

export function loadCollectionsRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, globalize.translate('Collections'), options,
        function () {
            return apiClient.getItems(userId, {
                SortBy: 'SortName', SortOrder: 'Ascending', Recursive: true,
                IncludeItemTypes: 'BoxSet', Fields: IMG_FIELDS,
                EnableTotalRecordCount: false, Limit: 20
            });
        },
        cardHtmlFn(getPortraitShape(options.enableOverflow)));
    return Promise.resolve();
}

export function loadPlaylistsRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, globalize.translate('Playlists'), options,
        function () {
            return apiClient.getItems(userId, {
                SortBy: 'SortName', SortOrder: 'Ascending', Recursive: true,
                IncludeItemTypes: 'Playlist', Fields: IMG_FIELDS,
                EnableTotalRecordCount: false, Limit: 20
            });
        },
        cardHtmlFn(getSquareShape(options.enableOverflow)));
    return Promise.resolve();
}

export function loadRewatchRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, 'Watch It Again', options,
        function () {
            return apiClient.getItems(userId, {
                SortBy: 'DatePlayed', SortOrder: 'Descending',
                Filters: 'IsPlayed', Recursive: true, IncludeItemTypes: 'Movie',
                Fields: IMG_FIELDS, EnableTotalRecordCount: false, Limit: 20
            });
        },
        cardHtmlFn(getPortraitShape(options.enableOverflow)));
    return Promise.resolve();
}

// Recently-added merged by media type instead of per library (Libraries > Merge Recent Rows by Type).
export function loadRecentByType(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    elem.classList.remove('verticalSection');
    const groups = [
        { label: 'Recently Added Movies', types: 'Movie', shape: getPortraitShape(options.enableOverflow), parent: false },
        { label: 'Recently Added Shows', types: 'Series', shape: getPortraitShape(options.enableOverflow), parent: false },
        { label: 'Recently Added Music', types: 'MusicAlbum', shape: getSquareShape(options.enableOverflow), parent: true }
    ];
    groups.forEach(function (g) {
        const frag = document.createElement('div');
        frag.classList.add('verticalSection');
        frag.classList.add('hide');
        elem.appendChild(frag);
        buildRow(frag, g.label, options,
            function () {
                return apiClient.getItems(userId, {
                    SortBy: 'DateCreated', SortOrder: 'Descending', Recursive: true,
                    IncludeItemTypes: g.types, Limit: 16, Fields: IMG_FIELDS,
                    ImageTypeLimit: 1, EnableImageTypes: 'Primary,Backdrop,Thumb',
                    EnableTotalRecordCount: false
                });
            },
            cardHtmlFn(g.shape, { showParentTitle: g.parent }));
    });
    return Promise.resolve();
}

// Merged "Continue Watching" — resume items + Next Up in one row (Home Screen > Merge CW & Next Up).
export function loadResumeMergedRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, globalize.translate('HeaderContinueWatching'), options,
        function () {
            const resumeP = apiClient.getItems(userId, {
                SortBy: 'DatePlayed', SortOrder: 'Descending', Filters: 'IsResumable',
                Recursive: true, IncludeItemTypes: 'Movie,Episode', MediaTypes: 'Video',
                Limit: 12, Fields: IMG_FIELDS, ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb', EnableTotalRecordCount: false
            }).then(function (r) { return (r && r.Items) || []; });
            const nextP = apiClient.getNextUpEpisodes({
                UserId: userId, Limit: 12, Fields: IMG_FIELDS, ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb'
            }).then(function (r) { return (r && r.Items) || []; }).catch(function () { return []; });
            return Promise.all([resumeP, nextP]).then(function (a) {
                const seen = {};
                a[0].forEach(function (i) { seen[i.Id] = 1; });
                return a[0].concat(a[1].filter(function (i) { return !seen[i.Id]; }));
            });
        },
        function (items) {
            return cardBuilder.getCardsHtml({
                items: items, shape: getBackdropShape(options.enableOverflow),
                preferThumb: true, showTitle: true, showParentTitle: true, showYear: true,
                overlayText: false, overlayPlayButton: true, centerText: true, lazy: true,
                cardLayout: false, context: 'home', lines: 2
            });
        }, 'videoplayback,markplayed');
    return Promise.resolve();
}

export function loadAudioRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    buildRow(elem, globalize.translate('HeaderLatestMusic') || 'Latest Music', options,
        function () {
            return apiClient.getItems(userId, {
                SortBy: 'DateCreated', SortOrder: 'Descending', Recursive: true,
                IncludeItemTypes: 'MusicAlbum', Fields: IMG_FIELDS,
                EnableTotalRecordCount: false, Limit: 20
            });
        },
        cardHtmlFn(getSquareShape(options.enableOverflow), { showParentTitle: true }));
    return Promise.resolve();
}

// "Because You Watched <X>": seeds from the most recently played movie, then similar items.
export function loadSinceYouWatchedRow(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    elem.classList.remove('verticalSection');
    return apiClient.getItems(userId, {
        Filters: 'IsPlayed', IncludeItemTypes: 'Movie', SortBy: 'DatePlayed',
        SortOrder: 'Descending', Recursive: true, Limit: 1
    }).then(function (res) {
        const seed = ((res && res.Items) || [])[0];
        if (!seed || !seed.Id) return;
        const frag = document.createElement('div');
        frag.classList.add('verticalSection');
        frag.classList.add('hide');
        elem.appendChild(frag);
        buildRow(frag, 'Because You Watched ' + seed.Name, options,
            function () {
                return apiClient.getJSON(apiClient.getUrl('Items/' + seed.Id + '/Similar', {
                    userId: userId, limit: 20, fields: IMG_FIELDS
                }));
            },
            cardHtmlFn(getPortraitShape(options.enableOverflow)));
    }).catch(function () { /* no watch history yet */ });
}

// One row per top genre (movies). Fetches genres first, then appends a sub-row each.
export function loadGenresRows(elem, apiClient, user, options) {
    const userId = apiClient.getCurrentUserId();
    elem.classList.remove('verticalSection');
    return apiClient.getGenres(userId, {
        SortBy: 'SortName', SortOrder: 'Ascending', Recursive: true,
        IncludeItemTypes: 'Movie', EnableTotalRecordCount: false, Limit: 30
    }).then(function (res) {
        // Drop genres whose name is purely numeric — Emby metadata artifacts (TMDB ids as names),
        // never real genres on any server; then keep the first few real ones.
        const genres = ((res && res.Items) || [])
            .filter(function (g) { return g && g.Name && !/^\d+$/.test(String(g.Name).trim()); })
            .slice(0, 4);
        genres.forEach(function (genre) {
            if (!genre || !genre.Id) return;
            const frag = document.createElement('div');
            frag.classList.add('verticalSection');
            frag.classList.add('hide');
            elem.appendChild(frag);
            buildRow(frag, genre.Name, options,
                function () {
                    return apiClient.getItems(userId, {
                        SortBy: 'Random', Recursive: true, IncludeItemTypes: 'Movie',
                        GenreIds: genre.Id, Fields: IMG_FIELDS,
                        EnableTotalRecordCount: false, Limit: 20
                    });
                },
                cardHtmlFn(getPortraitShape(options.enableOverflow)));
        });
    }).catch(function () { /* no genres available */ });
}
