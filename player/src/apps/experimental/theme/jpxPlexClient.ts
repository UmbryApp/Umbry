// Umbry — Plex-backed client shim + SDK adapter.
//
// Goal: make a Plex server render through the SAME native home / library / detail UI as Jellyfin
// and Emby, with no UI changes. The app pulls data through two stacked layers:
//   1. the legacy `apiClient` (ServerConnections.currentApiClient()) — used by cardBuilder image
//      sizing, the home section loaders, and the itemDetails controller;
//   2. the SDK `Api` built by `toApi(apiClient)` — used by React-Query home sections + hooks.
// We satisfy both: `makePlexApiClient` is a legacy-shaped client whose methods answer from Plex,
// and `plexSdkAdapter` is an axios adapter that maps the handful of Jellyfin SDK endpoints the
// UI hits to Plex responses (Jellyfin-shaped). Both are gated on the client being a Plex client,
// so Jellyfin/Emby behaviour is untouched.

import {
    PlexServer,
    getPlexLibraries,
    getPlexItems,
    getPlexCollections,
    getPlexSearch,
    getPlexCollectionItems,
    getPlexItemFull,
    getPlexLatest,
    getPlexChildren,
    getPlexOnDeck,
    getPlexGenres,
    getPlexItemsByGenre,
    getPlexSimilar,
    getPlexTrailer,
    plexSortParam,
    plexSortForLibrary,
    plexRaw,
    mapPlexItem,
    plexImageUrl,
    plexArtUrl,
    getPlexAccount,
    setPlexAccount
} from './jpxPlex';
import { wrapKidsMode } from './jpxParental';
import { wrapInclusion } from './jpxLibraryInclusion';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict = Record<string, any>;

interface ParsedId { kind: 'section' | 'collection' | 'item' | 'person'; key: string }

// Namespaced ids: `plex_<machine12>_sec<key>` | `plex_<machine12>_coll<rk>` | `plex_<machine12>_<rk>`.
function parsePlexId(srv: PlexServer, id: string): ParsedId {
    const prefix = srv.id + '_';
    let rest = id.indexOf(prefix) === 0 ? id.slice(prefix.length) : id.replace(/^plex_[^_]+_/, '');
    if (rest.indexOf('sec') === 0) return { kind: 'section', key: rest.slice(3) };
    if (rest.indexOf('coll') === 0) return { kind: 'collection', key: rest.slice(4) };
    // Cast/crew ids are tag ids, not library metadata — mark them so getItem returns a Person
    // stub (from the cast cache) instead of resolving them as an item (which fell through to the
    // first movie, the "A '90s Christmas" bug).
    if (rest.indexOf('person_') === 0) return { kind: 'person', key: rest.slice(7) };
    return { kind: 'item', key: rest };
}

// Server-wide query: Plex libraries are per-section, so aggregate across movie/show sections for
// queries that have no ParentId (the home hero's Movie,Series query, the Collections BoxSet row).
async function plexServerWide(srv: PlexServer, includeTypes: unknown, limit: number, sortBy?: unknown): Promise<Dict[]> {
    const inc = String(includeTypes || '');
    const sb = String(sortBy || '');
    // Map the Jellyfin SortBy (from the Media Bar Source Type) to a Plex sort.
    const plexSort = /random/i.test(sb) ? 'random'
        : /DateCreated|added/i.test(sb) ? 'addedAt:desc'
        : /Premiere|Release|Production|Date/i.test(sb) ? 'originallyAvailableAt:desc'
        : (sb ? 'titleSort' : undefined);
    const libs = await getPlexLibraries(srv);
    if (/BoxSet/i.test(inc)) {
        const arrs = await Promise.all(
            libs.filter(l => l.CollectionType === 'movies' || l.CollectionType === 'tvshows')
                .map(l => getPlexCollections(srv, String((l as any).__plexSection)).catch(() => [] as Dict[]))
        );
        return arrs.flat();
    }
    const wantMovies = !inc || /Movie/i.test(inc);
    const wantShows = !inc || /Series|Show/i.test(inc);
    const wanted = libs.filter(l => (wantMovies && l.CollectionType === 'movies') || (wantShows && l.CollectionType === 'tvshows'));
    if (!wanted.length) return [];
    const per = Math.max(6, Math.ceil((limit || 30) / wanted.length)) + 2;
    const fetchSort = plexSort === 'random' ? undefined : plexSort;
    const arrs = await Promise.all(wanted.map(l => getPlexItems(srv, String((l as any).__plexSection), 0, per, fetchSort).then(r => r.Items).catch(() => [] as Dict[])));
    const items = arrs.flat();
    if (plexSort === 'addedAt:desc') {
        items.sort((a, b) => (Number(b.__addedAt) || 0) - (Number(a.__addedAt) || 0));
    } else if (plexSort === 'originallyAvailableAt:desc') {
        items.sort((a, b) => (Number(b.ProductionYear) || 0) - (Number(a.ProductionYear) || 0));
    } else if (!plexSort || plexSort === 'random') {
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = items[i]; items[i] = items[j]; items[j] = t; }
    }
    return items.slice(0, limit || 30);
}

// A genre id we mint in getPlexGenres: `<srvId>_genre_<sectionKey>_<genreKey>`. Parse it back.
function parsePlexGenreId(srv: PlexServer, id: string): { section: string; genre: string } | null {
    const m = String(id || '').match(/_genre_([^_]+)_(.+)$/);
    return m ? { section: m[1], genre: m[2] } : null;
}

// Genres across the movie (and optionally show) sections, deduped by name. The main "Movies" section
// wins the dedup so an "Action"/"Comedy" row filters the primary library, not a niche one.
async function plexAllGenres(srv: PlexServer, includeTypes: unknown): Promise<Dict[]> {
    const inc = String(includeTypes || '');
    const wantShows = /Series|Show/i.test(inc);
    const wantMovies = !inc || /Movie/i.test(inc) || !wantShows;
    const libs = await getPlexLibraries(srv);
    const wanted = libs.filter(l => (wantMovies && l.CollectionType === 'movies') || (wantShows && l.CollectionType === 'tvshows'));
    wanted.sort((a, b) => (b.Name === 'Movies' ? 1 : 0) - (a.Name === 'Movies' ? 1 : 0));
    const arrs = await Promise.all(wanted.map(l => getPlexGenres(srv, String((l as any).__plexSection)).catch(() => [] as Dict[])));
    const seen = new Set<string>(); const out: Dict[] = [];
    arrs.flat().forEach(g => { const n = String(g.Name || '').toLowerCase(); if (n && !seen.has(n)) { seen.add(n); out.push(g); } });
    out.sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
    return out;
}

function plexUser(srv: PlexServer): Dict {
    return {
        Id: 'plexuser',
        Name: srv.accountName || srv.name,
        ServerId: srv.id,
        PrimaryImageTag: srv.avatar || undefined,
        HasPassword: false,
        HasConfiguredPassword: false,
        EnableAutoLogin: false,
        Policy: {
            IsAdministrator: false,
            IsDisabled: false,
            EnableContentDeletion: false,
            // Playback permissions — the PreplayIntercept validator blocks play without these.
            EnableMediaPlayback: true,
            EnableAudioPlaybackTranscoding: true,
            EnableVideoPlaybackTranscoding: true,
            EnablePlaybackRemuxing: true,
            EnableContentDownloading: true,
            EnableAllFolders: true,
            EnableAllDevices: true
        },
        Configuration: { LatestItemsExcludes: [], MyMediaExcludes: [], GroupedFolders: [] }
    };
}

// ---- Legacy apiClient shim -------------------------------------------------
export function makePlexApiClient(srv: PlexServer): Dict {
    const user = plexUser(srv);

    // Expose the active Plex host+token so the video player's hls.js xhrSetup can append the token
    // to transcode segment requests (Plex serves relative, token-less segment URLs).
    try { (window as any).__jpxPlex = { host: srv.base, token: srv.token }; } catch { /* SSR */ }

    const imageFor = (options: Dict = {}) => {
        const tag = options.tag;
        const isPath = typeof tag === 'string' && tag.indexOf('/') === 0;
        const isUrl = typeof tag === 'string' && /^https?:\/\//.test(tag);
        if (isPath || isUrl) {
            // clearLogo: serve the original image (keeps PNG transparency) with the token appended.
            if (options.type === 'Logo') {
                const p = isPath ? (srv.base + tag) : tag;
                return p + (p.indexOf('?') >= 0 ? '&' : '?') + 'X-Plex-Token=' + encodeURIComponent(srv.token);
            }
            // Backdrop/Art -> 16:9 transcode; everything else (posters, cast thumbs — Plex proxies the
            // absolute metadata-static.plex.tv URLs) -> the poster transcode.
            if (options.type === 'Backdrop' || options.type === 'Art') {
                return plexArtUrl(srv, tag, options.maxWidth || options.width || options.fillWidth || 1280) || '';
            }
            const w = options.maxWidth || options.width || options.fillWidth
                || (options.maxHeight ? Math.round(options.maxHeight * 2 / 3)
                    : (options.fillHeight ? Math.round(options.fillHeight * 2 / 3) : 400));
            return plexImageUrl(srv, tag, w) || '';
        }
        return '';
    };

    const client: Dict = {
        // Plex markers used by toApi() and the card image patch. NOTE: intentionally NO `_sdk` here —
        // ServerConnections.getApi() does `apiClient._sdk ??= toApi(apiClient)`, and toApi() detects
        // __plex and attaches the Plex adapter, so leaving _sdk unset lets a real (Plex-backed) SDK
        // Api be built lazily — which the React library hooks (useApi().api) need.
        __plex: true,
        __plexServer: srv,

        // Identity / config
        serverId: () => srv.id,
        serverAddress: () => srv.base,
        serverInfo: () => ({ Id: srv.id, Name: srv.name }),
        getServerInfo: () => ({ Id: srv.id, Name: srv.name }),
        accessToken: () => srv.token,
        getCurrentUserId: () => 'plexuser',
        // Plex user avatar is an absolute plex.tv URL cached on the server; some stock code
        // (connectionManager, UserCardBox, login) calls getUserImageUrl and crashed without this.
        getUserImageUrl: (_userId: string, _options?: Dict) => srv.avatar || null,
        appName: () => 'Umbry',
        appVersion: () => '1.0',
        deviceName: () => 'Browser',
        deviceId: () => 'plex-' + srv.id,
        isLoggedIn: () => true,
        getMaxBandwidth: () => null,
        subscribe: () => { /* no-op */ },

        // UserData actions (so the detail-page Favorite / Watched buttons don't throw on Plex).
        // Watched IS real on Plex (scrobble). Plex library items have no per-item "favorite", so
        // that one accepts + resolves (the UI toggle is cosmetic on Plex, not persisted).
        markPlayed: (_userId: string, itemId: string) => {
            const rk = parsePlexId(srv, String(itemId)).key;
            return fetch(srv.base + '/:/scrobble?identifier=com.plexapp.plugins.library&key=' + rk + '&X-Plex-Token=' + encodeURIComponent(srv.token), { method: 'GET' }).then(() => ({})).catch(() => ({}));
        },
        markUnplayed: (_userId: string, itemId: string) => {
            const rk = parsePlexId(srv, String(itemId)).key;
            return fetch(srv.base + '/:/unscrobble?identifier=com.plexapp.plugins.library&key=' + rk + '&X-Plex-Token=' + encodeURIComponent(srv.token), { method: 'GET' }).then(() => ({})).catch(() => ({}));
        },
        updateFavoriteStatus: (_userId: string, _itemId: string, _isFavorite: boolean) => Promise.resolve({}),

        getCurrentUser: async () => {
            // Uniformity: carry the plex.tv account name + avatar (like Jellyfin/Emby carry the
            // user's Name + image). Lazy-fetch once for servers saved before this, then cache.
            if (!srv.avatar || !srv.accountName) {
                try {
                    const acct = await getPlexAccount(srv.token);
                    if (acct.avatar) srv.avatar = acct.avatar;
                    if (acct.name) srv.accountName = acct.name;
                    if (acct.avatar || acct.name) setPlexAccount(srv.id, acct);
                } catch { /* keep defaults */ }
            }
            if (srv.avatar) user.PrimaryImageTag = srv.avatar;
            if (srv.accountName) user.Name = srv.accountName;
            return user;
        },

        // Images
        getScaledImageUrl: (_itemId: string, options: Dict) => imageFor(options),
        getImageUrl: (_itemId: string, options: Dict) => imageFor(options),

        // URLs
        getUrl(path: string, params?: Dict) {
            let p = path.indexOf('/') === 0 ? path : '/' + path;
            // Umbry: the audio pipeline requests 'Audio/{id}/universal' (a Jellyfin endpoint) —
            // serve Plex's own universal MUSIC transcode instead: any source format -> mp3 320.
            const am = /^\/Audio\/([^/]+)\/universal/.exec(p);
            if (am) {
                const key = String(am[1]).split('_').pop() as string;
                // PlaybackInfo (runs first) cached the exact stream URL for this track — a DIRECT
                // file part for browser-native formats (seekable), else a transcode. Prefer it.
                try {
                    const cache = (window as unknown as Dict).__jpxPlexAudio as Dict | undefined;
                    if (cache && cache[key]) return String(cache[key]);
                } catch { /* ignore */ }
                // Fallback: universal music transcode (full session params — the minimal set 400s).
                const s2 = 'jpx' + Math.random().toString(36).slice(2, 10);
                return srv.base + '/music/:/transcode/universal/start?' + [
                    'path=' + encodeURIComponent('/library/metadata/' + key),
                    'mediaIndex=0', 'partIndex=0', 'musicBitrate=320', 'protocol=http',
                    'directPlay=0', 'directStream=0', 'hasMDE=1',
                    'session=' + s2, 'X-Plex-Session-Identifier=' + s2, 'X-Plex-Client-Identifier=' + s2,
                    'X-Plex-Product=Umbry', 'X-Plex-Version=1.0', 'X-Plex-Platform=Chrome',
                    'X-Plex-Platform-Version=120', 'X-Plex-Device=Linux', 'X-Plex-Device-Name=Umbry',
                    'X-Plex-Token=' + encodeURIComponent(srv.token)
                ].join('&');
            }
            if (params && typeof params === 'object') {
                const usp = new URLSearchParams();
                Object.keys(params).forEach(k => { const v = (params as Dict)[k]; if (v !== null && v !== undefined) usp.append(k, String(v)); });
                const qs = usp.toString();
                if (qs) p += (p.indexOf('?') >= 0 ? '&' : '?') + qs;
            }
            return srv.base + p + (p.indexOf('?') >= 0 ? '&' : '?') + 'X-Plex-Token=' + encodeURIComponent(srv.token);
        },
        getJSON(url: string) {
            const full = /^https?:\/\//.test(url) ? url : this.getUrl(url);
            return fetch(full, { headers: { Accept: 'application/json' } }).then(r => r.json()).catch(() => ({}));
        },
        ajax(request: Dict) {
            return fetch(request.url, { method: request.type || 'GET', headers: { Accept: 'application/json' } })
                .then(r => (request.dataType === 'json' ? r.json() : r.text())).catch(() => null);
        },

        // Data
        getUserViews: () => getPlexLibraries(srv).then(Items => ({ Items, TotalRecordCount: Items.length })),

        getItems: async (_userId: string, query: Dict = {}) => {
            try {
                // Fetch specific items by id (used by the Watchlist home row). Plex takes a
                // comma-separated list of rating keys on /library/metadata; map each to a card item.
                const idsRaw = query.Ids || query.ids;
                if (idsRaw) {
                    const keys = String(idsRaw).split(',').map(s => s.trim()).filter(Boolean)
                        .map(id => parsePlexId(srv, id)).filter(p => p.kind === 'item').map(p => p.key);
                    if (!keys.length) return { Items: [], TotalRecordCount: 0 };
                    const mc = await plexRaw(srv, '/library/metadata/' + keys.join(',')).catch(() => ({} as Dict));
                    const items = ((mc.Metadata as Dict[]) || []).map(m => mapPlexItem(srv, m));
                    return { Items: items, TotalRecordCount: items.length };
                }
                // Music play-expansion: MusicArtist Play sends {ArtistIds, MediaTypes:Audio};
                // album/queue plays may send {AlbumIds}. Neither carries a ParentId, so without
                // this they fell through to plexServerWide -> the MOVIE library -> "A 90s Christmas"
                // (first movie alphabetically). Fetch the real tracks via Plex /allLeaves.
                const artistIds = query.ArtistIds || query.artistIds || query.AlbumIds || query.albumIds;
                if (artistIds) {
                    const akey = parsePlexId(srv, String(artistIds).split(',')[0].trim()).key;
                    const leaf = await plexRaw(srv, '/library/metadata/' + akey + '/allLeaves?X-Plex-Container-Size=1000').catch(() => ({} as Dict));
                    let tItems = ((leaf.Metadata as Dict[]) || []).map(m => mapPlexItem(srv, m));
                    if (!tItems.length) tItems = await getPlexChildren(srv, akey).catch(() => [] as Dict[]);
                    return { Items: tItems, TotalRecordCount: tItems.length };
                }
                const pid = query.ParentId;
                const limit = Number(query.Limit || query.limit || 100);
                const genre = parsePlexGenreId(srv, String(query.GenreIds || query.GenreId || query.ParentId || ''));
                if (genre) return await getPlexItemsByGenre(srv, genre.section, genre.genre, limit, Number(query.StartIndex || 0), String(query.SortBy || ''));
                if (pid) {
                    const p = parsePlexId(srv, String(pid));
                    if (p.kind === 'section') {
                        // Collections tab: a section + BoxSet filter -> that library's collections.
                        if (/BoxSet/i.test(String(query.IncludeItemTypes || ''))) {
                            const colls = await getPlexCollections(srv, p.key);
                            return { Items: colls, TotalRecordCount: colls.length };
                        }
                        if (/DateCreated|added/i.test(String(query.SortBy || ''))) {
                            const items = await getPlexLatest(srv, p.key, limit);
                            return { Items: items, TotalRecordCount: items.length };
                        }
                        return await getPlexItems(srv, p.key, Number(query.StartIndex || 0), limit, plexSortForLibrary(String(query.SortBy || ''), String(query.SortOrder || '')));
                    }
                    if (p.kind === 'collection') return await getPlexCollectionItems(srv, p.key);
                    if (p.kind === 'item') {
                        const items = await getPlexChildren(srv, p.key);
                        return { Items: items, TotalRecordCount: items.length };
                    }
                }
                // No ParentId — a server-wide query (hero Movie,Series; Collections BoxSet row).
                // Plex has no Jellyfin-style favorites, so an IsFavorite query returns nothing.
                if (/IsFavorite/i.test(String(query.Filters || '')) || query.IsFavorite === true) {
                    return { Items: [], TotalRecordCount: 0 };
                }
                // Never let an AUDIO-scoped server-wide query resolve to movies/shows (the root of
                // the "every song opens A 90s Christmas" bug). We have no server-wide music play, so
                // return empty rather than the movie library.
                const _mt = String(query.MediaTypes || query.mediaTypes || '');
                const _it = String(query.IncludeItemTypes || '');
                if (/Audio/i.test(_mt) || /\bAudio\b|MusicAlbum|MusicArtist/i.test(_it)) {
                    return { Items: [], TotalRecordCount: 0 };
                }
                const wide = await plexServerWide(srv, query.IncludeItemTypes, limit, query.SortBy);
                return { Items: wide, TotalRecordCount: wide.length };
            } catch { return { Items: [], TotalRecordCount: 0 }; }
        },

        getItem: async (_userId: string, id: string) => {
            const g = parsePlexGenreId(srv, String(id));
            if (g) { const gl = await getPlexGenres(srv, g.section).catch(() => [] as Dict[]); return gl.find(x => String(x.Id) === String(id)) || { Id: id, ServerId: srv.id, Name: '', Type: 'Genre', IsFolder: true }; }
            const p = parsePlexId(srv, String(id));
            if (p.kind === 'person') {
                // Return a Person item (name + headshot from the cast cache populated when the
                // movie/show detail rendered its People) so the custom person page shows, not a movie.
                let cached: Dict | null = null;
                try { cached = ((window as unknown as Dict).__jpxPlexPersons as Dict)?.[String(id)] as Dict; } catch { /* ignore */ }
                const thumb = cached && cached.thumb ? String(cached.thumb) : '';
                return {
                    Id: id, ServerId: srv.id, Name: (cached && String(cached.name)) || '',
                    Type: 'Person', IsFolder: false,
                    ImageTags: thumb ? { Primary: thumb } : {},
                    PrimaryImageAspectRatio: 1,
                    __primaryImageUrl: thumb ? plexImageUrl(srv, thumb, 400) : null,
                    ProviderIds: {}
                };
            }
            if (p.kind === 'item') return await getPlexItemFull(srv, p.key);
            if (p.kind === 'collection') {
                // A Plex collection -> a Jellyfin BoxSet detail page: fetch the collection's own
                // metadata (name/art) + its children so the header renders and the "Items" list fills.
                const meta = await plexRaw(srv, '/library/metadata/' + p.key)
                    .then((mc: any) => ((mc.Metadata || [])[0]) || null).catch(() => null);
                const kids = await getPlexCollectionItems(srv, p.key).then(r => r.Items).catch(() => [] as Dict[]);
                return {
                    Id: id, ServerId: srv.id,
                    Name: (meta && meta.title) || 'Collection',
                    Type: 'BoxSet', IsFolder: true, ChildCount: kids.length,
                    Overview: meta && meta.summary,
                    ImageTags: { Primary: String((meta && meta.thumb) || '') },
                    PrimaryImageAspectRatio: 0.6666667,
                    __primaryImageUrl: (meta && meta.thumb) ? plexImageUrl(srv, meta.thumb as string, 400) : null,
                    BackdropImageTags: (meta && meta.art) ? [ String(meta.art) ] : [],
                    __backdropUrl: (meta && meta.art) ? plexArtUrl(srv, meta.art as string, 1280) : null
                };
            }
            // A library section folder.
            const Items = await getPlexChildren(srv, p.key).catch(() => [] as Dict[]);
            return { Id: id, ServerId: srv.id, Type: 'CollectionFolder', IsFolder: true, ChildCount: Items.length };
        },

        getSeasons: async (seriesId: string) => {
            const p = parsePlexId(srv, String(seriesId));
            const items = await getPlexChildren(srv, p.key).catch(() => []);
            return { Items: items, TotalRecordCount: items.length };
        },

        getEpisodes: async (itemId: string, query: Dict = {}) => {
            const src = query.SeasonId || itemId;
            const p = parsePlexId(srv, String(src));
            const items = await getPlexChildren(srv, p.key).catch(() => []);
            return { Items: items, TotalRecordCount: items.length };
        },

        // Rows we don't source from Plex yet — return empty so the section hides itself.
        getTrailerUrl: (itemId: string) => { try { const p = parsePlexId(srv, String(itemId)); return getPlexTrailer(srv, p.key); } catch { return Promise.resolve(null); } },
        getSimilarItems: (itemId: string, opts: Dict = {}) => { const p = parsePlexId(srv, String(itemId)); return getPlexSimilar(srv, p.key, Number(opts.limit || opts.Limit || 12)).then(Items => ({ Items, TotalRecordCount: Items.length })).catch(() => ({ Items: [], TotalRecordCount: 0 })); },
        getNextUpEpisodes: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getResumeItems: () => getPlexOnDeck(srv).then(Items => ({ Items, TotalRecordCount: Items.length })).catch(() => ({ Items: [], TotalRecordCount: 0 })),
        getUserItems: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getGenres: (_userId: string, opts: Dict = {}) => plexAllGenres(srv, opts && opts.IncludeItemTypes).then(Items => ({ Items, TotalRecordCount: Items.length })).catch(() => ({ Items: [], TotalRecordCount: 0 })),
        getPeople: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getArtists: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getLiveTvChannels: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getLiveTvRecordings: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),

        // Playback reporting — Plex has no Jellyfin session API, so these are no-ops.
        reportPlaybackStart: () => Promise.resolve(),
        reportPlaybackProgress: () => Promise.resolve(),
        reportPlaybackStopped: () => Promise.resolve(),
        stopActiveEncodings: () => Promise.resolve(),
        getEndpointInfo: () => Promise.resolve({ IsInNetwork: true, IsLocal: false }),
        getPublicSystemInfo: () => Promise.resolve({ Version: '10.10.0', ProductName: 'Jellyfin', StartupWizardCompleted: true, Id: srv.id, ServerName: srv.name }),
        getPublicUsers: () => Promise.resolve([]),
        getSavedEndpointInfo: () => ({ IsInNetwork: true, IsLocal: false }),

        // Extra surfaces the player + detail controller touch. Plex has no equivalent for most, so
        // these resolve empty (intros, trailers, instant mixes, live TV, genre/artist lookups).
        getIntros: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getLocalTrailers: () => Promise.resolve([]),
        getInstantMixFromItem: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getAdditionalVideoParts: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getSpecialFeatures: () => Promise.resolve([]),
        getArtist: () => Promise.resolve({}),
        getGenre: () => Promise.resolve({}),
        getMusicGenre: () => Promise.resolve({}),
        getLiveTvChannel: () => Promise.resolve({}),
        getLiveTvPrograms: () => Promise.resolve({ Items: [], TotalRecordCount: 0 }),
        getLiveTvSeriesTimer: () => Promise.resolve({}),
        getLiveTvTimers: () => Promise.resolve({ Items: [], TotalRecordCount: 0 })
    };

    // Kids Mode: filter the Plex shim’s list methods (rating + hidden libraries), mirroring the
    // Jellyfin ApiClient prototype patch. No-op when Kids Mode is off.
    // Umbry: also apply the per-server library inclusion allowlist to the Plex shim.
    return wrapInclusion(wrapKidsMode(client)) as Dict;
}

// ---- SDK axios adapter -----------------------------------------------------
// Maps the Jellyfin SDK endpoints the home/detail actually call to Plex responses.
export function plexSdkAdapter(srv: PlexServer) {
    return function plexAdapter(config: Dict) {
        const respond = (data: any) => Promise.resolve({
            data, status: 200, statusText: 'OK',
            headers: { 'content-type': 'application/json' }, config, request: {}
        });
        try {
            const rawUrl = String(config.url || '');
            const qi = rawUrl.indexOf('?');
            const path = qi >= 0 ? rawUrl.slice(0, qi) : rawUrl;
            const search = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');
            const params: Dict = config.params || {};
            const getp = (k: string) => (params[k] != null ? params[k] : search.get(k));

            // Playback — return a direct-play MediaSource pointing at the Plex stream URL. With
            // Protocol Http + SupportsDirectPlay and no direct-stream/transcode, supportsDirectPlay()
            // approves it and the native player loads mediaSource.Path directly.
            if (/PlaybackInfo$/.test(path)) {
                const m = path.match(/Items\/([^/]+)\/PlaybackInfo/);
                const idPart = m ? m[1] : (getp('itemId') || getp('ItemId'));
                if (idPart) {
                    const p = parsePlexId(srv, String(idPart));
                    return getPlexItemFull(srv, p.key).then((it: any) => {
                        // Tracks get an AUDIO MediaSource. Browser-native containers (mp3/flac/aac/…)
                        // DIRECT-PLAY the file part (verified 200 audio/mpeg + seekable) — far more
                        // reliable than Plex's finicky music-transcode endpoint. Exotic formats
                        // (ape/wma/wv/dsf) fall back to the universal transcode with FULL session
                        // params (the minimal set 400s). Without any of this, play errored and the
                        // retry fell into the VIDEO pipeline → a song opened the movie player.
                        if (it && (it.MediaType === 'Audio' || it.Type === 'Audio')) {
                            const acont = String(it.__container || '').toLowerCase();
                            const nativeAudio = /^(mp3|aac|m4a|mp4|flac|ogg|oga|opus|wav|wave|weba|webm)$/.test(acont);
                            let apath: string;
                            if (it.__streamUrl && nativeAudio) {
                                apath = String(it.__streamUrl);
                            } else {
                                const asess = 'jpx' + Math.random().toString(36).slice(2, 12);
                                apath = srv.base + '/music/:/transcode/universal/start?' + [
                                    'path=' + encodeURIComponent('/library/metadata/' + p.key),
                                    'mediaIndex=0', 'partIndex=0', 'musicBitrate=320', 'protocol=http',
                                    'directPlay=0', 'directStream=0', 'hasMDE=1',
                                    'session=' + asess, 'X-Plex-Session-Identifier=' + asess, 'X-Plex-Client-Identifier=' + asess,
                                    'X-Plex-Product=Umbry', 'X-Plex-Version=1.0', 'X-Plex-Platform=Chrome',
                                    'X-Plex-Platform-Version=120', 'X-Plex-Device=Linux', 'X-Plex-Device-Name=Umbry',
                                    'X-Plex-Token=' + encodeURIComponent(srv.token)
                                ].join('&');
                            }
                            // Cache so getUrl('Audio/{id}/universal') returns the SAME url (that path
                            // is what the audio pipeline actually fetches).
                            try {
                                const w = window as unknown as Dict;
                                w.__jpxPlexAudio = (w.__jpxPlexAudio as Dict) || {};
                                (w.__jpxPlexAudio as Dict)[String(p.key)] = apath;
                            } catch { /* SSR */ }
                            const ams = {
                                Id: p.key, ItemId: String(idPart), Path: apath,
                                Protocol: 'Http', SupportsDirectPlay: true, SupportsDirectStream: false,
                                SupportsTranscoding: false, IsRemote: false, IsInfiniteStream: false,
                                RequiredHttpHeaders: [], Container: nativeAudio ? (acont || 'mp3') : 'mp3',
                                Name: it.Name, RunTimeTicks: it.RunTimeTicks,
                                MediaStreams: [ { Type: 'Audio', Codec: nativeAudio ? (acont || 'mp3') : 'mp3', Index: 0, IsDefault: true } ]
                            };
                            return respond({ MediaSources: [ams], PlaySessionId: 'plexa-' + p.key });
                        }
                        const streamUrl = it && it.__streamUrl;
                        const container = String((it && it.__container) || '').toLowerCase();
                        const codec = String((it && it.__videoCodec) || '').toLowerCase();
                        // Browsers can direct-play mp4/mov/m4v/webm with a mainstream codec; anything
                        // else (mkv, avi, ts, hevc-in-mkv, …) is transcoded by Plex to HLS.
                        const browserNative = /^(mp4|mov|m4v|webm)$/.test(container) && /(h264|avc|vp8|vp9|av01|av1)/.test(codec);
                        const baseStreams = [
                            { Type: 'Video', Codec: codec || 'h264', Index: 0, IsDefault: true },
                            { Type: 'Audio', Codec: 'aac', Index: 1, Language: 'eng', IsDefault: true }
                        ];
                        if (streamUrl && browserNative) {
                            const ms = {
                                Id: p.key, ItemId: String(idPart), Path: streamUrl,
                                Protocol: 'Http', SupportsDirectPlay: true, SupportsDirectStream: false,
                                SupportsTranscoding: false, IsRemote: false, IsInfiniteStream: false,
                                RequiredHttpHeaders: [], Container: container || 'mp4',
                                Name: it && it.Name, RunTimeTicks: it && it.RunTimeTicks, MediaStreams: baseStreams
                            };
                            return respond({ MediaSources: [ms], PlaySessionId: 'plex-' + p.key });
                        }
                        // Transcode: Plex universal HLS. getUrl() appends the token to the start
                        // playlist; the player's hls.js xhrSetup appends it to each segment.
                        const session = 'jpx' + Math.random().toString(36).slice(2, 12);
                        const tp = [
                            'hasMDE=1',
                            'path=' + encodeURIComponent('/library/metadata/' + p.key),
                            'mediaIndex=0', 'partIndex=0', 'protocol=hls', 'fastSeek=1',
                            'directPlay=0', 'directStream=1', 'subtitleSize=100', 'audioBoost=100',
                            'location=lan', 'autoAdjustQuality=0', 'directStreamAudio=1', 'mediaBufferSize=102400',
                            'session=' + session, 'subtitles=burn', 'copyts=1',
                            'X-Plex-Session-Identifier=' + session,
                            'X-Plex-Product=Umbry', 'X-Plex-Version=1.0',
                            'X-Plex-Client-Identifier=' + session,
                            'X-Plex-Platform=Chrome', 'X-Plex-Platform-Version=120',
                            'X-Plex-Device=OSX', 'X-Plex-Device-Name=Umbry'
                        ].join('&');
                        const ms = {
                            Id: p.key, ItemId: String(idPart),
                            Protocol: 'Http', SupportsDirectPlay: false, SupportsDirectStream: false,
                            SupportsTranscoding: true,
                            TranscodingUrl: '/video/:/transcode/universal/start.m3u8?' + tp,
                            TranscodingSubProtocol: 'hls', TranscodingContainer: 'ts',
                            IsRemote: false, IsInfiniteStream: false, RequiredHttpHeaders: [],
                            Container: container, Name: it && it.Name, RunTimeTicks: it && it.RunTimeTicks,
                            MediaStreams: baseStreams
                        };
                        return respond({ MediaSources: (streamUrl || it) ? [ms] : [], PlaySessionId: session });
                    });
                }
                return respond({ MediaSources: [], PlaySessionId: '' });
            }

            if (/(^|\/)(UserViews|Views)$/.test(path)) {
                return getPlexLibraries(srv).then(Items => respond({ Items, TotalRecordCount: Items.length, StartIndex: 0 }));
            }
            if (/Items\/Latest$/.test(path)) {
                const parentId = getp('parentId') || getp('ParentId');
                const limit = Number(getp('limit') || getp('Limit') || 16);
                if (parentId) {
                    const p = parsePlexId(srv, String(parentId));
                    if (p.kind === 'section') return getPlexLatest(srv, p.key, limit).then(a => respond(a));
                }
                return respond([]);
            }
            if (/Resume$/.test(path)) {
                const mt = String(getp('mediaTypes') || getp('MediaTypes') || '');
                return getPlexOnDeck(srv)
                    .then(all => {
                        // Plex on-deck is video; only fill the matching resume row (Video), leave
                        // Continue Listening/Reading (Audio/Book) empty.
                        const Items = !mt ? all : all.filter((it: any) => String(it.MediaType || 'Video').toLowerCase() === mt.toLowerCase());
                        return respond({ Items, TotalRecordCount: Items.length, StartIndex: 0 });
                    })
                    .catch(() => respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
            }
            if (/NextUp$/.test(path)) return respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
            if (/Genres$/.test(path)) {
                const gpid = getp('parentId') || getp('ParentId');
                const gp = gpid ? parsePlexId(srv, String(gpid)) : null;
                if (gp && gp.kind === 'section') return getPlexGenres(srv, gp.key).then(Items => respond({ Items, TotalRecordCount: Items.length })).catch(() => respond({ Items: [], TotalRecordCount: 0 }));
                return plexAllGenres(srv, getp('includeItemTypes') || getp('IncludeItemTypes')).then(Items => respond({ Items, TotalRecordCount: Items.length })).catch(() => respond({ Items: [], TotalRecordCount: 0 }));
            }
            if (/\/Similar$/.test(path)) {
                const ms = path.match(/Items\/([^/]+)\/Similar/);
                if (ms) { const p = parsePlexId(srv, ms[1]); return getPlexSimilar(srv, p.key, Number(getp('limit') || getp('Limit') || 12)).then(Items => respond({ Items, TotalRecordCount: Items.length })).catch(() => respond({ Items: [], TotalRecordCount: 0 })); }
                return respond({ Items: [], TotalRecordCount: 0 });
            }
            // getMovieRecommendations returns an ARRAY (RecommendationDto[]), not {Items}. Plex has no
            // equivalent, so return an empty array — else SuggestionsSectionView does {Items}.map() and crashes.
            if (/Recommendations$/.test(path)) return respond([]);
            if (/\/Seasons$/.test(path)) {
                const m = path.match(/Shows\/([^/]+)\/Seasons/);
                if (m) { const p = parsePlexId(srv, m[1]); return getPlexChildren(srv, p.key).then(Items => respond({ Items, TotalRecordCount: Items.length })); }
                return respond({ Items: [], TotalRecordCount: 0 });
            }
            if (/\/Episodes$/.test(path)) {
                const seasonId = getp('seasonId') || getp('SeasonId');
                const m = path.match(/Shows\/([^/]+)\/Episodes/);
                const key = seasonId ? parsePlexId(srv, String(seasonId)).key : (m ? parsePlexId(srv, m[1]).key : null);
                if (key) return getPlexChildren(srv, key).then(Items => respond({ Items, TotalRecordCount: Items.length }));
                return respond({ Items: [], TotalRecordCount: 0 });
            }
            const mItem = path.match(/(?:Users\/[^/]+\/Items|UserItems|Items)\/([^/]+)$/);
            if (mItem && mItem[1] && mItem[1] !== 'Latest' && mItem[1] !== 'Resume') {
                const gm = parsePlexGenreId(srv, mItem[1]);
                if (gm) return getPlexGenres(srv, gm.section).then(list => respond(list.find(x => String(x.Id) === mItem[1]) || { Id: mItem[1], ServerId: srv.id, Name: '', Type: 'Genre', IsFolder: true })).catch(() => respond({ Id: mItem[1], ServerId: srv.id, Name: '', Type: 'Genre', IsFolder: true }));
                const p = parsePlexId(srv, mItem[1]);
                if (p.kind === 'person') {
                    let cached: Dict | null = null;
                    try { cached = ((window as unknown as Dict).__jpxPlexPersons as Dict)?.[mItem[1]] as Dict; } catch { /* ignore */ }
                    const thumb = cached && cached.thumb ? String(cached.thumb) : '';
                    return respond({
                        Id: mItem[1], ServerId: srv.id, Name: (cached && String(cached.name)) || '',
                        Type: 'Person', IsFolder: false,
                        ImageTags: thumb ? { Primary: thumb } : {},
                        PrimaryImageAspectRatio: 1, ProviderIds: {}
                    });
                }
                if (p.kind === 'item') return getPlexItemFull(srv, p.key).then(it => respond(it || {}));
                // A single-item fetch on a library/collection id (e.g. useItem() in the library
                // toolbar) — return a folder-shaped item so the query resolves instead of hanging.
                return getPlexLibraries(srv).then(libs => {
                    const lib = libs.find(l => String(l.Id) === mItem[1] || String((l as any).__plexSection) === p.key);
                    return respond(lib || {
                        Id: mItem[1], ServerId: srv.id, Name: '',
                        Type: p.kind === 'collection' ? 'BoxSet' : 'CollectionFolder',
                        CollectionType: getp('collectionType') || undefined, IsFolder: true
                    });
                });
            }
            if (/Search\/Hints$/i.test(path)) {
                const term = getp('searchTerm') || getp('SearchTerm');
                if (!term) return respond({ SearchHints: [], TotalRecordCount: 0 });
                return getPlexSearch(srv, String(term), Number(getp('limit') || getp('Limit') || 50))
                    .then(items => respond({ SearchHints: items, TotalRecordCount: items.length }))
                    .catch(() => respond({ SearchHints: [], TotalRecordCount: 0 }));
            }
            if (/(^|\/)Items$/.test(path)) {
                const parentId = getp('parentId') || getp('ParentId');
                const limit = Number(getp('limit') || getp('Limit') || 100);
                // Genre filter (from a genreIds param, or a genre id used as parentId) wins over the
                // section branch — the Genres tab sends BOTH parentId=section and genreIds=[genre].
                const gidTop = parsePlexGenreId(srv, String(getp('genreIds') || getp('GenreIds') || parentId || ''));
                if (gidTop) return getPlexItemsByGenre(srv, gidTop.section, gidTop.genre, limit, Number(getp('startIndex') || getp('StartIndex') || 0), String(getp('sortBy') || getp('SortBy') || '')).then(r => respond({ Items: r.Items, TotalRecordCount: r.TotalRecordCount, StartIndex: 0 })).catch(() => respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
                if (parentId) {
                    const p = parsePlexId(srv, String(parentId));
                    if (p.kind === 'section') {
                        // Collections tab: section + BoxSet filter -> that library's collections.
                        if (/BoxSet/i.test(String(getp('includeItemTypes') || getp('IncludeItemTypes') || ''))) {
                            return getPlexCollections(srv, p.key).then(colls => respond({ Items: colls, TotalRecordCount: colls.length, StartIndex: 0 }));
                        }
                        const sw = getp('nameStartsWith') || getp('NameStartsWith');
                        if (sw) {
                            const L = String(sw).toUpperCase();
                            return getPlexItems(srv, p.key, 0, 5000, plexSortForLibrary(String(getp('sortBy') || getp('SortBy') || ''), String(getp('sortOrder') || getp('SortOrder') || ''))).then(r => {
                                const filtered = (r.Items as Dict[]).filter((it) => {
                                    const cc = String(it.Name || '').replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase();
                                    return L === '#' ? !(cc >= 'A' && cc <= 'Z') : cc === L;
                                });
                                return respond({ Items: filtered, TotalRecordCount: filtered.length, StartIndex: 0 });
                            });
                        }
                        return getPlexItems(srv, p.key, Number(getp('startIndex') || getp('StartIndex') || 0), limit, plexSortForLibrary(String(getp('sortBy') || getp('SortBy') || ''), String(getp('sortOrder') || getp('SortOrder') || ''))).then(r => respond({ Items: r.Items, TotalRecordCount: r.TotalRecordCount, StartIndex: 0 }));
                    }
                    if (p.kind === 'collection') return getPlexCollectionItems(srv, p.key).then(r => respond({ Items: r.Items, TotalRecordCount: r.TotalRecordCount, StartIndex: 0 }));
                    if (p.kind === 'item') return getPlexChildren(srv, p.key).then(Items => respond({ Items, TotalRecordCount: Items.length, StartIndex: 0 }));
                }
                // No ParentId — server-wide query (hero Movie,Series; Collections BoxSet).
                const fav = getp('isFavorite') || getp('IsFavorite');
                if (fav === true || fav === 'true' || /IsFavorite/i.test(String(getp('filters') || getp('Filters') || ''))) {
                    return respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
                }
                return plexServerWide(srv, getp('includeItemTypes') || getp('IncludeItemTypes'), limit, getp('sortBy') || getp('SortBy'))
                    .then(items => respond({ Items: items, TotalRecordCount: items.length, StartIndex: 0 }))
                    .catch(() => respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
            }
            return respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        } catch {
            return respond({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        }
    };
}
