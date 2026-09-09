// Umbry — Plex Media Server adapter. Pulls libraries / items / images DIRECTLY from a PMS HTTP
// API (its CORS reflects our origin, so the browser can fetch it) and maps the responses into
// Jellyfin-shaped objects so Plex content renders natively in the app — no routing to Plex, no
// bridge. Registered Plex servers live in localStorage; ids/section keys are namespaced.

import { getPlexClientId } from './jpxPlexAuth';
import { schedulePush } from './jpxCloud';

const KEY = 'jpx-plex-servers';
const COLL: Record<string, string> = { movie: 'movies', show: 'tvshows', artist: 'music', photo: 'homevideos' };
const TYPE: Record<string, string> = { movie: 'Movie', show: 'Series', episode: 'Episode', season: 'Season', artist: 'MusicArtist', album: 'MusicAlbum', track: 'Audio' };

export interface PlexServer { id: string; name: string; base: string; token: string; avatar?: string; accountName?: string }
type Dict = Record<string, unknown>;

export function getPlexServers(): PlexServer[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') as PlexServer[]; } catch { return []; }
}
function savePlexServers(list: PlexServer[]): void {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
    try { schedulePush(); } catch { /* ignore */ }  // backend-synced (DisplayPrefs mirror retired)
}
export function getPlexServer(id: string): PlexServer | undefined {
    return getPlexServers().find(s => s.id === id);
}
export function removePlexServer(id: string): void {
    savePlexServers(getPlexServers().filter(s => s.id !== id));
    try { if (localStorage.getItem('jpx-active-plex') === id) localStorage.removeItem('jpx-active-plex'); } catch { /* ignore */ }
}

/** The signed-in Plex account's info (avatar URL + display name) from plex.tv. Uses the ACCOUNT
 *  token (from sign-in / the owner's token), like resolvePlexAccessToken does. Mirrors what
 *  Jellyfin/Emby give per user (Name + image), so the Plex user looks identical out of the box. */
export async function getPlexAccount(accountToken: string): Promise<{ avatar?: string; name?: string }> {
    try {
        const r = await fetch('https://plex.tv/api/v2/user', {
            headers: {
                Accept: 'application/json',
                'X-Plex-Product': 'Umbry',
                'X-Plex-Client-Identifier': getPlexClientId(),
                'X-Plex-Token': accountToken
            }
        });
        if (!r.ok) return {};
        const u = await r.json() as Dict;
        return {
            avatar: u && u.thumb ? String(u.thumb) : undefined,
            name: u && (u.title || u.username) ? String(u.title || u.username) : undefined
        };
    } catch { return {}; }
}

/** Cache resolved account info (avatar + name) back onto the saved server (later loads skip fetch). */
export function setPlexAccount(id: string, info: { avatar?: string; name?: string }): void {
    const list = getPlexServers();
    const s = list.find(x => x.id === id);
    if (!s) return;
    let changed = false;
    if (info.avatar && s.avatar !== info.avatar) { s.avatar = info.avatar; changed = true; }
    if (info.name && s.accountName !== info.name) { s.accountName = info.name; changed = true; }
    if (changed) savePlexServers(list);
}

async function plexGet(base: string, token: string, path: string): Promise<Dict> {
    const url = base + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'X-Plex-Token=' + encodeURIComponent(token);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('plex ' + res.status);
    const d = await res.json();
    return (d && (d as Dict).MediaContainer as Dict) || {};
}

// Does this token grant library access to this server? (Owner + most shared users: yes with the
// account token; some shared setups need the server-specific access token instead.)
async function plexHasAccess(base: string, token: string): Promise<boolean> {
    try { await plexGet(base, token, '/library/sections'); return true; } catch { return false; }
}

// For a shared server, plex.tv issues a per-server access token that differs from the account token.
// Fetch the user's resources and return the accessToken for the server with this machineIdentifier.
async function resolvePlexAccessToken(accountToken: string, machineId: string): Promise<string | null> {
    try {
        const r = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
            headers: {
                Accept: 'application/json',
                'X-Plex-Product': 'Umbry',
                'X-Plex-Client-Identifier': getPlexClientId(),
                'X-Plex-Token': accountToken
            }
        });
        if (!r.ok) return null;
        const list = await r.json() as Array<Dict>;
        const match = Array.isArray(list) ? list.find(x => String(x.clientIdentifier) === machineId) : null;
        const at = match && match.accessToken ? String(match.accessToken) : '';
        return at || null;
    } catch { return null; }
}

/** Validate a Plex address+token and register it. Returns the server or null. */
export async function addPlexServer(rawBase: string, token: string): Promise<PlexServer | null> {
    let base = rawBase.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) base = 'http://' + base;
    try {
        const identity = await plexGet(base, token, '/identity');
        const machineId = String(identity.machineIdentifier || '');
        if (!machineId) return null;

        // Pick the token that actually grants library access. Try the account token (owner path);
        // if it's refused, fall back to the server-specific access token from plex.tv resources.
        let useToken = token;
        let accessOk = await plexHasAccess(base, useToken);
        if (!accessOk) {
            const at = await resolvePlexAccessToken(token, machineId);
            if (at) { useToken = at; accessOk = await plexHasAccess(base, useToken); }
        }
        if (!accessOk) return null; // signed in, but this account has no access to this server

        let name = 'Plex';
        try { name = String((await plexGet(base, useToken, '/')).friendlyName || 'Plex'); } catch { /* keep default */ }
        const acct = await getPlexAccount(token);
        const srv: PlexServer = { id: 'plex_' + machineId.slice(0, 12), name, base, token: useToken, avatar: acct.avatar, accountName: acct.name };
        savePlexServers([ ...getPlexServers().filter(s => s.id !== srv.id), srv ]);
        return srv;
    } catch { return null; }
}

export function plexImageUrl(srv: PlexServer, path: string | undefined, w = 400): string | null {
    if (!path) return null;
    return srv.base + '/photo/:/transcode?width=' + w + '&height=' + Math.round(w * 1.5)
        + '&minSize=1&upscale=1&url=' + encodeURIComponent(path) + '&X-Plex-Token=' + encodeURIComponent(srv.token);
}

/** Plex libraries -> Jellyfin CollectionFolder "views". */
export async function getPlexLibraries(srv: PlexServer): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/library/sections');
    const dirs = (mc.Directory as Dict[]) || [];
    return dirs.map(d => ({
        Id: srv.id + '_sec' + d.key,
        Name: d.title,
        ServerId: srv.id,
        CollectionType: COLL[String(d.type)] || 'mixed',
        Type: 'CollectionFolder',
        IsFolder: true,
        __plexServerId: srv.id,
        __plexSection: String(d.key),
        __serverName: srv.name
    }));
}

/** Plex metadata item -> Jellyfin item (carries a ready-to-use __primaryImageUrl). */
export function mapPlexItem(srv: PlexServer, m: Dict): Dict {
    const type = String(m.type);
    // clearLogo ships in the list response Image[] too, so home rows + the hero get the logo (the
    // hero renders item.ImageTags.Logo; without this Plex items fell back to a plain text title).
    const logoImg = ((m.Image as Dict[]) || []).find(im => String(im.type) === 'clearLogo');
    return {
        Id: srv.id + '_' + m.ratingKey,
        Name: m.title,
        ServerId: srv.id,
        Type: TYPE[type] || 'Movie',
        MediaType: (type === 'movie' || type === 'episode' || type === 'clip') ? 'Video' : (type === 'track' ? 'Audio' : undefined),
        PrimaryImageAspectRatio: (type === 'episode') ? 1.7777778 : (type === 'artist' || type === 'album' || type === 'track') ? 1 : 0.6666667,
        ProductionYear: m.year,
        Overview: m.summary,
        RunTimeTicks: (Number(m.duration) || 0) * 10000,
        CommunityRating: m.audienceRating ?? m.rating,
        OfficialRating: m.contentRating,
        IsFolder: type === 'show' || type === 'season' || type === 'artist' || type === 'album',
        ImageTags: { Primary: String(m.thumb || ''), ...(logoImg ? { Logo: String(logoImg.url) } : {}) },
        // Music fields (tracks/albums) — the player, pill and album page read these.
        IndexNumber: m.index != null ? Number(m.index) : undefined,
        ParentIndexNumber: m.parentIndex != null ? Number(m.parentIndex) : undefined,
        Album: type === 'track' ? (m.parentTitle as string) : undefined,
        AlbumId: (type === 'track' && m.parentRatingKey) ? srv.id + '_' + m.parentRatingKey : undefined,
        AlbumArtist: (type === 'track' || type === 'album') ? ((m.grandparentTitle || m.parentTitle) as string) : undefined,
        Artists: (type === 'track' && m.grandparentTitle) ? [ String(m.grandparentTitle) ] : undefined,
        AlbumPrimaryImageTag: type === 'track' ? String(m.parentThumb || m.thumb || '') : undefined,
        ChildCount: type === 'album' ? (Number(m.leafCount) || undefined) : undefined,
        __plexServerId: srv.id,
        __plexRatingKey: String(m.ratingKey),
        __addedAt: Number(m.addedAt) || 0,
        __primaryImageUrl: plexImageUrl(srv, m.thumb as string),
        BackdropImageTags: m.art ? [ String(m.art) ] : [],
        __artPath: m.art ? String(m.art) : undefined,
        __backdropUrl: m.art ? plexArtUrl(srv, m.art as string, 1280) : null
    };
}

/** Items in a Plex library section, mapped + paged like a Jellyfin item query. */
export async function getPlexItems(srv: PlexServer, sectionKey: string, start = 0, size = 60, sort?: string): Promise<{ Items: Dict[]; TotalRecordCount: number }> {
    const mc = await plexGet(srv.base, srv.token,
        '/library/sections/' + sectionKey + '/all?' + (sort ? 'sort=' + encodeURIComponent(sort) + '&' : '') + 'X-Plex-Container-Start=' + start + '&X-Plex-Container-Size=' + size);
    const meta = (mc.Metadata as Dict[]) || [];
    return { Items: meta.map(m => mapPlexItem(srv, m)), TotalRecordCount: Number(mc.totalSize) || meta.length };
}

/** Map a Jellyfin SortBy to a Plex sort token. Plex 400s on unknown sorts (e.g. "SortName"), so
 *  anything unrecognized returns undefined (Plex then uses its default). */
export function plexSortParam(sb?: string): string | undefined {
    const s = String(sb || '');
    if (!s || /random/i.test(s)) return undefined;
    if (/SortName|Name|title/i.test(s)) return 'titleSort';
    if (/DateCreated|added/i.test(s)) return 'addedAt:desc';
    if (/Premiere|Release|Production|Date/i.test(s)) return 'originallyAvailableAt:desc';
    if (/Runtime|duration/i.test(s)) return 'duration';
    if (/Rating/i.test(s)) return 'rating:desc';
    return undefined;
}

/** Map a Jellyfin (SortBy, SortOrder) to a directional Plex library sort. Plex 400s on unknown
 *  sorts, so anything unrecognized returns undefined (Plex then uses its default order). Random has
 *  no reliable Plex sort, so it also falls through to the default. */
export function plexSortForLibrary(sortBy?: string, sortOrder?: string): string | undefined {
    const s = String(sortBy || '');
    if (!s || /random/i.test(s)) return undefined;
    const base = /SortName|title/i.test(s) || /^Name$/i.test(s) ? 'titleSort'
        : /DateCreated|added/i.test(s) ? 'addedAt'
        : /Premiere|Release|Production|Date$/i.test(s) ? 'originallyAvailableAt'
        : /Runtime|duration/i.test(s) ? 'duration'
        : /OfficialRating|contentRating/i.test(s) ? 'contentRating'
        : /Community|Critic|Rating/i.test(s) ? 'rating'
        : /PlayCount/i.test(s) ? 'viewCount'
        : /DatePlayed|lastViewed/i.test(s) ? 'lastViewedAt'
        : undefined;
    if (!base) return undefined;
    return base + (/desc/i.test(String(sortOrder || '')) ? ':desc' : ':asc');
}

/** Genres in a Plex library section -> [{ Name, Id }]. The Id encodes section+genre so a later
 *  getItems({ GenreIds }) can filter (`<srvId>_genre_<sectionKey>_<genreKey>`). */
export async function getPlexGenres(srv: PlexServer, sectionKey: string): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/library/sections/' + sectionKey + '/genre');
    const dirs = (mc.Directory as Dict[]) || [];
    return dirs
        .map(d => ({ Name: String(d.title || ''), Id: srv.id + '_genre_' + sectionKey + '_' + String(d.key), Type: 'Genre', ServerId: srv.id, IsFolder: true }))
        .filter(g => g.Name);
}

/** Items in a Plex section filtered to one genre, mapped like a Jellyfin item query. Plex has no
 *  reliable random sort, so fetch a window off the top and shuffle client-side for row variety. */
export async function getPlexItemsByGenre(srv: PlexServer, sectionKey: string, genreKey: string, size = 20, start = 0, sort?: string): Promise<{ Items: Dict[]; TotalRecordCount: number }> {
    const psort = plexSortParam(sort);
    // Small preview rows (limit <= 25) with no explicit sort shuffle a window for variety; the full
    // genre LIST page (bigger limit, real paging) sorts by title so StartIndex paging is stable.
    const wantRandom = /random/i.test(String(sort || '')) || (!psort && size <= 25);
    const effSort = psort || (wantRandom ? undefined : 'titleSort');
    const fetchSize = effSort ? size : Math.max(size * 2, 40);
    const mc = await plexGet(srv.base, srv.token,
        '/library/sections/' + sectionKey + '/all?type=1&genre=' + encodeURIComponent(genreKey)
        + (effSort ? '&sort=' + encodeURIComponent(effSort) : '')
        + '&X-Plex-Container-Start=' + start + '&X-Plex-Container-Size=' + fetchSize);
    const meta = (mc.Metadata as Dict[]) || [];
    const items = meta.map(m => mapPlexItem(srv, m));
    const total = Number(mc.totalSize) || items.length;
    if (effSort) return { Items: items, TotalRecordCount: total };
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = items[i]; items[i] = items[j]; items[j] = t; }
    return { Items: items.slice(0, size), TotalRecordCount: total };
}

/** Plex collections in a library section -> Jellyfin BoxSet-shaped items. */
/** Titles a person appears in, on a Plex server. `tagId` is the Plex Role/crew tag id (the
 *  `person_<id>` key minted in mapPlexItem's People). Plex has no cross-section person query, so
 *  aggregate each relevant library section with the `?actor=<id>` filter -- falling back to
 *  director/writer/producer for crew-only people -- then dedupe. Without this the custom person
 *  page's { PersonIds } query fell through to the whole movie library (wrong filmography + random
 *  backdrops drawn from it). Mirrors getPlexItemsByGenre's /sections/{key}/all pattern. */
export async function getPlexPersonFilmography(srv: PlexServer, tagId: string, kind: string, limit = 300, sort?: string): Promise<Dict[]> {
    if (!/^\d+$/.test(String(tagId || ''))) return [];
    const wantShows = /Series|Show/i.test(String(kind || ''));
    const type = wantShows ? 2 : 1;
    const collType = wantShows ? 'tvshows' : 'movies';
    const libs = await getPlexLibraries(srv);
    const wanted = libs.filter(l => l.CollectionType === collType);
    if (!wanted.length) return [];
    const psort = plexSortForLibrary(sort, 'Ascending') || 'originallyAvailableAt:desc';
    const fetchField = async (field: string): Promise<Dict[]> => {
        const arrs = await Promise.all(wanted.map(l => plexGet(srv.base, srv.token,
            '/library/sections/' + String(l.__plexSection) + '/all?type=' + type
            + '&' + field + '=' + encodeURIComponent(tagId)
            + '&sort=' + encodeURIComponent(psort)
            + '&X-Plex-Container-Size=' + limit)
            .then(mc => ((mc.Metadata as Dict[]) || []).map(m => mapPlexItem(srv, m)))
            .catch(() => [] as Dict[])));
        return arrs.flat();
    };
    let items = await fetchField('actor');
    if (!items.length) {
        for (const f of ['director', 'writer', 'producer']) {
            items = await fetchField(f); // eslint-disable-line no-await-in-loop
            if (items.length) break;
        }
    }
    const seen: Record<string, boolean> = {};
    return items.filter(i => (seen[String(i.Id)] ? false : (seen[String(i.Id)] = true)));
}

export async function getPlexCollections(srv: PlexServer, sectionKey: string): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/library/sections/' + sectionKey + '/collections?X-Plex-Container-Size=300');
    const meta = (mc.Metadata as Dict[]) || [];
    return meta.map(m => ({
        Id: srv.id + '_coll' + m.ratingKey,
        Name: m.title,
        ServerId: srv.id,
        Type: 'BoxSet',
        IsFolder: true,
        ChildCount: Number(m.childCount) || 0,
        ImageTags: { Primary: String(m.thumb || '') },
        __plexServerId: srv.id,
        __plexCollection: String(m.ratingKey),
        __primaryImageUrl: plexImageUrl(srv, m.thumb as string)
    }));
}

/** Items inside a Plex collection, mapped like a Jellyfin item query. */
export async function getPlexCollectionItems(srv: PlexServer, ratingKey: string): Promise<{ Items: Dict[]; TotalRecordCount: number }> {
    const mc = await plexGet(srv.base, srv.token, '/library/collections/' + ratingKey + '/children?X-Plex-Container-Size=500');
    const meta = (mc.Metadata as Dict[]) || [];
    return { Items: meta.map(m => mapPlexItem(srv, m)), TotalRecordCount: Number(mc.size) || meta.length };
}

/** A single Plex item's full metadata -> Jellyfin item. */
export async function getPlexItem(srv: PlexServer, ratingKey: string): Promise<Dict | null> {
    const mc = await plexGet(srv.base, srv.token, '/library/metadata/' + ratingKey);
    const m = ((mc.Metadata as Dict[]) || [])[0];
    return m ? mapPlexItem(srv, m) : null;
}

/** Landscape (backdrop) image URL from a Plex art path. */
export function plexArtUrl(srv: PlexServer, path: string | undefined, w = 1280): string | null {
    if (!path) return null;
    return srv.base + '/photo/:/transcode?width=' + w + '&height=' + Math.round(w * 9 / 16)
        + '&minSize=1&url=' + encodeURIComponent(path) + '&X-Plex-Token=' + encodeURIComponent(srv.token);
}

/** Direct-play stream URL for a Plex media part (browser plays it via <video>, range-seekable). */
export function plexStreamUrl(srv: PlexServer, partKey: string): string {
    return srv.base + partKey + (partKey.indexOf('?') >= 0 ? '&' : '?') + 'X-Plex-Token=' + encodeURIComponent(srv.token);
}

/** Full metadata for a Plex item (backdrop, logo, genres, cast+crew, studios, media streams, and a
 *  direct-play stream URL) — mapped to the Jellyfin shape the Moonfin detail header reads so a Plex
 *  detail page matches Jellyfin/Emby (logo, cast photos, Crew/Studios/Details tabs). */
export async function getPlexItemFull(srv: PlexServer, ratingKey: string): Promise<Dict | null> {
    const mc = await plexGet(srv.base, srv.token, '/library/metadata/' + ratingKey);
    const m = ((mc.Metadata as Dict[]) || [])[0];
    if (!m) return null;
    const base = mapPlexItem(srv, m);
    const media = (((m.Media as Dict[]) || [])[0]) || {};
    const part = (((media.Part as Dict[]) || [])[0]) || {};
    const tags = (a: unknown) => ((a as Dict[]) || []).map(x => String(x.tag));
    const container = String(media.container || '');
    const codec = String(media.videoCodec || '');

    // People: cast (Role) then crew (Director / Writer / Producer). Plex actor thumbs are absolute
    // URLs (metadata-static.plex.tv); carried as PrimaryImageTag — the Plex image shim proxies them.
    const person = (r: Dict, type: string) => {
        const pid = srv.id + '_person_' + String(r.id || r.tag);
        // Cache name+thumb so a click into this cast member (getItem on the person id, which is a
        // tag id with no library metadata) can render a proper Person page instead of a movie.
        try {
            const w = window as unknown as Dict;
            w.__jpxPlexPersons = (w.__jpxPlexPersons as Dict) || {};
            (w.__jpxPlexPersons as Dict)[pid] = { name: String(r.tag), thumb: r.thumb ? String(r.thumb) : '' };
        } catch { /* SSR */ }
        return {
            Name: String(r.tag), Role: String(r.role || ''), Type: type,
            Id: pid, ServerId: srv.id,
            PrimaryImageTag: r.thumb ? String(r.thumb) : undefined,
            PrimaryImageAspectRatio: 0.6666667,
            __primaryImageUrl: r.thumb ? plexImageUrl(srv, String(r.thumb), 240) : null
        };
    };
    const cast = ((m.Role as Dict[]) || []).slice(0, 20).map(r => person(r, 'Actor'));
    const crew = [
        ...((m.Director as Dict[]) || []).map(r => person(r, 'Director')),
        ...((m.Writer as Dict[]) || []).map(r => person(r, 'Writer')),
        ...((m.Producer as Dict[]) || []).slice(0, 12).map(r => person(r, 'Producer'))
    ];

    // MediaStreams from Plex Part.Stream (streamType 1/2/3 = Video/Audio/Subtitle) for the Details tab.
    const streams = ((part.Stream as Dict[]) || []).map(s => {
        const st = Number(s.streamType);
        return {
            Type: st === 1 ? 'Video' : st === 2 ? 'Audio' : st === 3 ? 'Subtitle' : 'Data',
            Codec: String(s.codec || ''),
            Language: s.language ? String(s.language) : undefined,
            DisplayTitle: s.displayTitle ? String(s.displayTitle) : (s.extendedDisplayTitle ? String(s.extendedDisplayTitle) : undefined),
            IsDefault: s.default === 1 || s.default === '1' || s.selected === 1 || s.selected === '1',
            Width: s.width ? Number(s.width) : undefined,
            Height: s.height ? Number(s.height) : undefined,
            BitDepth: s.bitDepth ? Number(s.bitDepth) : undefined,
            Channels: s.channels ? Number(s.channels) : undefined,
            ChannelLayout: s.audioChannelLayout ? String(s.audioChannelLayout) : undefined,
            AverageFrameRate: s.frameRate ? Number(s.frameRate) : undefined,
            VideoRange: /(pq|hlg|smpte2084|bt2020)/i.test(String(s.colorTrc || '') + ' ' + String(s.colorSpace || '')) ? 'HDR' : undefined
        };
    });
    const mediaSource = {
        Id: String(media.id || ratingKey),
        Path: part.file ? String(part.file) : undefined,
        Container: container,
        Size: part.size ? Number(part.size) : undefined,
        MediaStreams: streams
    };

    const logoImg = ((m.Image as Dict[]) || []).find(im => String(im.type) === 'clearLogo');

    return {
        ...base,
        ImageTags: { ...((base.ImageTags as Dict) || {}), ...(logoImg ? { Logo: String(logoImg.url) } : {}) },
        __backdropUrl: plexArtUrl(srv, m.art as string, 1280),
        Genres: tags(m.Genre),
        GenreItems: tags(m.Genre).map((g: string) => ({ Name: g, Id: '' })),
        Directors: tags(m.Director),
        Studios: m.studio ? [{ Name: String(m.studio), Id: '' }] : [],
        Taglines: m.tagline ? [String(m.tagline)] : [],
        People: [ ...cast, ...crew ],
        Cast: cast.map(c => ({ Name: c.Name, Role: c.Role, Img: c.__primaryImageUrl })),
        MediaSources: [ mediaSource ],
        __container: container,
        __videoCodec: codec,
        __videoResolution: String(media.videoResolution || ''),
        __streamUrl: part.key ? plexStreamUrl(srv, String(part.key)) : null,
        // Browsers direct-play mp4/h264; anything else would need a Plex transcode (not built yet).
        __directPlayable: /(mp4|mov|m4v)/i.test(container) && /(h264|avc)/i.test(codec)
    };
}

/** Plex "more like this" for an item -> mapped Jellyfin items (the detail page Similar tab). */
export async function getPlexSimilar(srv: PlexServer, ratingKey: string, limit = 12): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/library/metadata/' + ratingKey + '/similar?limit=' + limit);
    return ((mc.Metadata as Dict[]) || []).slice(0, limit).map(m => mapPlexItem(srv, m));
}

/** A Plex item's trailer extra -> a direct (redirecting) MP4 stream URL for a <video>, or null.
 *  Plex serves trailers via its IVA service (/services/iva/.../video.mp4); the browser follows the
 *  302 chain to a seekable CDN mp4. Prefers the longest 'trailer' extra (the main trailer). */
export async function getPlexTrailer(srv: PlexServer, ratingKey: string): Promise<string | null> {
    try {
        const mc = await plexGet(srv.base, srv.token, '/library/metadata/' + ratingKey + '/extras');
        const meta = (mc.Metadata as Dict[]) || [];
        const trailers = meta.filter(e => String(e.subtype) === 'trailer' || Number(e.extraType) === 1);
        if (!trailers.length) return null;
        trailers.sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0));
        const part = ((((trailers[0].Media as Dict[]) || [])[0] || {}).Part as Dict[] || [])[0];
        const key = part && part.key ? String(part.key) : '';
        return key ? plexStreamUrl(srv, key) : null;
    } catch { return null; }
}

/** Plex accounts -> a simple user list (names sanitized — Plex allows HTML in managed-user names). */
export async function getPlexUsers(srv: PlexServer): Promise<Array<{ Id: string; Name: string }>> {
    const mc = await plexGet(srv.base, srv.token, '/accounts');
    const accts = (mc.Account as Dict[]) || [];
    return accts
        .filter(a => Number(a.id) > 0)
        .map(a => ({ Id: srv.id + '_user' + a.id, Name: String(a.name || '').replace(/<[^>]*>/g, '').trim() || ('User ' + a.id) }));
}

// ---- Umbry native-UI client helpers (used by jpxPlexClient) ----

/** Raw MediaContainer for an arbitrary Plex path (token appended). */
export async function plexRaw(srv: PlexServer, path: string): Promise<Dict> {
    return plexGet(srv.base, srv.token, path);
}

/** Most-recently-added items in a Plex section, mapped like a Jellyfin /Items/Latest array. */
export async function getPlexLatest(srv: PlexServer, sectionKey: string, limit = 16): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token,
        "/library/sections/" + sectionKey + "/all?sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=" + limit);
    return ((mc.Metadata as Dict[]) || []).map(m => mapPlexItem(srv, m));
}

/** Children of a Plex item (seasons of a show, episodes of a season), mapped to Jellyfin items. */
export async function getPlexChildren(srv: PlexServer, ratingKey: string): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token,
        "/library/metadata/" + ratingKey + "/children?X-Plex-Container-Size=800");
    return ((mc.Metadata as Dict[]) || []).map(m => mapPlexItem(srv, m));
}


/** Plex Continue Watching (on-deck) items, mapped with resume position. */
export async function getPlexOnDeck(srv: PlexServer): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/library/onDeck?X-Plex-Container-Size=30');
    return ((mc.Metadata as Dict[]) || []).map(m => {
        const it = mapPlexItem(srv, m);
        it.UserData = { PlaybackPositionTicks: (Number(m.viewOffset) || 0) * 10000, PlayedPercentage: 0, Played: false, IsFavorite: false };
        return it;
    });
}

/** Plex server-wide search via /hubs/search -> mapped Jellyfin items (movies/shows/episodes/etc). */
export async function getPlexSearch(srv: PlexServer, query: string, limit = 50): Promise<Dict[]> {
    const mc = await plexGet(srv.base, srv.token, '/hubs/search?query=' + encodeURIComponent(query) + '&limit=' + limit);
    const hubs = (mc.Hub as Dict[]) || [];
    const out: Dict[] = [];
    hubs.forEach(hub => {
        const t = String(hub.type || '');
        if (t === 'movie' || t === 'show' || t === 'episode' || t === 'season' || t === 'artist' || t === 'album') {
            ((hub.Metadata as Dict[]) || []).forEach(m => out.push(mapPlexItem(srv, m)));
        }
    });
    return out;
}
