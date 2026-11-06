import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { appHost } from '../../components/apphost';
import profileBuilder from '../../scripts/browserDeviceProfile';
import Events from '../../utils/events.ts';
import { playbackManager } from '../../components/playback/playbackmanager';
import { appRouter } from '../../components/router/appRouter';
import { currentSettings as userSettings } from '../../scripts/settings/userSettings';
import inputManager from '../../scripts/inputManager';
import { jpxT } from '../../apps/experimental/theme/jpxI18n';

// Umbry native video player.
//
// On the Android (Capacitor) app this MediaPlayer plugin takes over ALL video playback from the
// WebView <video>/htmlVideoPlayer path, handing the stream to a native ExoPlayer (the `NativeVideo`
// Capacitor plugin -> NativePlayerActivity). jellyfin's playbackManager still does every bit of the
// orchestration: it resolves the correct stream URL for whichever server you're on (Jellyfin
// direct/transcode AND the Emby/Plex shim MediaSources), supplies the resume position, and consumes
// our timeupdate/stopped events for progress reporting + mark-watched. We are a thin, local-managed
// surface over one native player -- so we deliberately do NOT implement getPlaylist (that would flip
// us out of local management).
//
// Selection: priority -1 sorts us ahead of htmlVideoPlayer (priority 1); canPlayMediaType only claims
// video when the native NativeVideo plugin is present, so on the web build we vanish and htmlVideoPlayer
// wins as before.

function nativeVideo() {
    const w = window;
    return (w.Capacitor && w.Capacitor.Plugins && w.Capacitor.Plugins.NativeVideo) || null;
}

function hasNative() {
    return !!nativeVideo();
}

// Android MediaCodec MIME -> jellyfin/ffmpeg codec name. Only what we can map is claimed; anything the
// device can't decode is simply absent from getCodecs() -> the server transcodes it (rare).
const V_MAP = {
    'video/avc': 'h264', 'video/hevc': 'hevc', 'video/x-vnd.on2.vp8': 'vp8',
    'video/x-vnd.on2.vp9': 'vp9', 'video/av01': 'av1', 'video/mp4v-es': 'mpeg4',
    'video/mpeg2': 'mpeg2video', 'video/mpeg': 'mpeg2video', 'video/3gpp': 'h263',
    'video/x-ms-wmv': 'wmv3', 'video/dolby-vision': 'hevc'
};
const A_MAP = {
    'audio/mp4a-latm': 'aac', 'audio/mpeg': 'mp3', 'audio/mpeg-l1': 'mp1', 'audio/mpeg-l2': 'mp2',
    'audio/ac3': 'ac3', 'audio/eac3': 'eac3', 'audio/ac4': 'ac4', 'audio/flac': 'flac',
    'audio/vorbis': 'vorbis', 'audio/opus': 'opus', 'audio/raw': 'pcm', 'audio/alac': 'alac',
    'audio/vnd.dts': 'dts', 'audio/vnd.dts.hd': 'dts', 'audio/true-hd': 'truehd',
    'audio/amr-wb': 'amr_wb', 'audio/3gpp': 'amr_nb'
};

// Build a jellyfin DeviceProfile from the device's real decoder list so Emby/Jellyfin DIRECT-PLAY
// anything this phone decodes (a static, byte-range-seekable file) instead of a live HLS transcode
// (which seeks badly and desyncs A/V — e.g. a FLAC-audio mkv that the browser profile needlessly
// transcodes). Falls back inside getDeviceProfile if the device query fails.
function buildNativeProfile(caps) {
    const vset = new Set();
    const aset = new Set();
    ((caps && caps.video) || []).forEach((m) => { const c = V_MAP[String(m).toLowerCase()]; if (c) vset.add(c); });
    ((caps && caps.audio) || []).forEach((m) => { const c = A_MAP[String(m).toLowerCase()]; if (c) aset.add(c); });
    // Floor: every ExoPlayer build decodes these; guarantees a usable direct-play set + transcode target.
    vset.add('h264');
    aset.add('aac'); aset.add('mp3');
    const vcodecs = Array.from(vset);
    const acodecs = Array.from(aset);
    return {
        MaxStreamingBitrate: 120000000,
        MaxStaticBitrate: 100000000,
        MusicStreamingTranscodingBitrate: 384000,
        DirectPlayProfiles: [
            { Container: 'mp4,m4v,mkv,webm,mov,ts,m2ts,avi,3gp,flv,ogv,ogm,wmv', Type: 'Video', VideoCodec: vcodecs.join(','), AudioCodec: acodecs.join(',') },
            { Container: 'mp3,aac,flac,alac,m4a,m4b,ogg,oga,opus,wav,webma,ape,wv', Type: 'Audio' }
        ],
        TranscodingProfiles: [
            { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6', MinSegments: '1', BreakOnNonKeyFrames: true },
            { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2' }
        ],
        ContainerProfiles: [],
        CodecProfiles: [],
        // Direct-play keeps embedded subs inside the container -> the native CC button reads them.
        SubtitleProfiles: [
            { Format: 'srt', Method: 'Embed' }, { Format: 'subrip', Method: 'Embed' },
            { Format: 'ass', Method: 'Embed' }, { Format: 'ssa', Method: 'Embed' },
            { Format: 'pgssub', Method: 'Embed' }, { Format: 'dvdsub', Method: 'Embed' },
            { Format: 'vtt', Method: 'Embed' }, { Format: 'sub', Method: 'Embed' },
            // Separate subtitle files (and text subs while transcoding) come as side files the
            // native player loads only when picked.
            { Format: 'vtt', Method: 'External' }, { Format: 'srt', Method: 'External' },
            { Format: 'subrip', Method: 'External' }, { Format: 'ass', Method: 'External' }, { Format: 'ssa', Method: 'External' }
        ],
        ResponseProfiles: []
    };
}

export class JpxNativeVideoPlayer {
    name = 'Umbry Native Video Player';
    type = PluginType.MediaPlayer;
    id = 'jpxnativevideoplayer';
    priority = -1;

    constructor() {
        this._currentTimeMs = 0;
        this._durationMs = 0;
        this._paused = false;
        this._volume = 100;
        this._muted = false;
        this._started = false;
        this._stopped = true;
        this._listeners = [];
        this._url = null;
        this._playOptions = null;
        this._resolveStart = null;
        this._rejectStart = null;
    }

    _attachNativeListeners() {
        const nv = nativeVideo();
        if (!nv || this._listeners.length) return;
        const add = (evt, fn) => {
            try {
                const h = nv.addListener(evt, fn);
                this._listeners.push(h);
            } catch (e) { /* ignore */ }
        };
        const markStarted = () => {
            if (this._started) return;
            this._started = true;
            if (this._resolveStart) { this._resolveStart(); }
            this._resolveStart = null;
            this._rejectStart = null;
        };
        add('playing', () => {
            this._paused = false;
            if (!this._started) {
                this._applyStartSubtitle();
                setTimeout(() => { if (!this._pushUpNext()) setTimeout(() => this._pushUpNext(), 4000); }, 1500);
            }
            markStarted();
            Events.trigger(this, 'playing');
            Events.trigger(this, 'unpause');
        });
        add('timeupdate', (d) => {
            if (d && typeof d.positionMs === 'number') { this._currentTimeMs = d.positionMs; }
            if (d && typeof d.durationMs === 'number' && d.durationMs > 0) { this._durationMs = d.durationMs; }
            markStarted();
            Events.trigger(this, 'timeupdate');
        });
        add('pause', () => { this._paused = true; Events.trigger(this, 'pause'); });
        add('resume', () => { this._paused = false; Events.trigger(this, 'unpause'); });
        add('ended', (d) => {
            if (d && typeof d.positionMs === 'number') { this._currentTimeMs = d.positionMs; }
            this._finishStopped();
        });
        add('error', (d) => {
            Events.trigger(this, 'error', [{ type: /source|http|response code|network|unable to connect|timeout/i.test(String(d && d.message || '')) ? 'NETWORK_ERROR' : 'MEDIA_DECODE_ERROR', message: d && d.message }]);
            if (!this._started && this._rejectStart) {
                const rej = this._rejectStart;
                this._rejectStart = null; this._resolveStart = null;
                rej(new Error((d && d.message) || 'native playback error'));
            }
            this._finishStopped();
        });
        // The user closed the native player (back button) -> treat as a stop so playbackManager saves
        // the resume position and runs its stop reporting.
        // Umbry controls: what the person picked in the native player's menus.
        add('osd', (d) => { this._onOsd(d || {}); });
        add('dismiss', (d) => {
            if (d && typeof d.positionMs === 'number') { this._currentTimeMs = d.positionMs; }
            // A user close is a stop, not an end: without this playbackManager auto-plays the next
            // queued item (Back on an episode started the next episode).
            if (!this._stopped) playbackManager._playNextAfterEnded = false;
            this._finishStopped();
        });
    }

    // The subtitle playbackManager chose (Settings → Subtitles, or the Detail page pick) for a track the
    // player shows itself; burned-in / transcoded ones are already in the picture.
    _applyStartSubtitle() {
        const o = this._playOptions || {};
        const ms = o.mediaSource || {};
        const idx = (o.subtitleStreamIndex != null) ? o.subtitleStreamIndex : ms.DefaultSubtitleStreamIndex;
        const s = idx != null && idx >= 0 ? this._streams('Subtitle').find(x => x.Index === idx) : null;
        const own = s && (s.DeliveryMethod === 'External' || s.IsExternal || (s.DeliveryMethod === 'Embed' && o.playMethod !== 'Transcode'));
        if (own) this.setSubtitleStreamIndex(idx);
        else if (!s && o.playMethod !== 'Transcode') { const nv = nativeVideo(); try { if (nv) nv.selectTrack({ type: 'text', ordinal: -1 }); } catch (e) { /* ignore */ } }
    }

    _detachNativeListeners() {
        this._listeners.forEach((h) => { try { if (h && h.remove) { h.remove(); } } catch (e) { /* ignore */ } });
        this._listeners = [];
    }

    _finishStopped() {
        if (this._stopped) return;
        this._stopped = true;
        Events.trigger(this, 'stopped', [{ src: this._url }]);
    }

    _buildSubtitles() {
        // Phase 2: do NOT side-load external subtitle sidecars. Handing ExoPlayer the server's external
        // .vtt tracks makes it a MergingMediaSource that BLOCKS playback preparation until every sidecar
        // loads — and Emby/Jellyfin generate each embedded-sub .vtt on demand via ffmpeg (~8s each), so
        // a file with several subtitle tracks hangs forever at 0:00 with a black screen and no error
        // (ExoPlayer never even fetches a video segment). Verified in the Emby server log for a 6-sub mkv.
        // Non-blocking subtitle support (lazy-load only the selected track, or burn/embed via the profile)
        // is a Phase 3 task. Embedded/burned subs still work via the native controller's CC button.
        return [];
    }

    // A transcode manifest (Plex universal HLS, Emby/Jellyfin HLS) carries an auth param on the master
    // URL, but the segment/sub-playlist URIs inside it may drop it -> a native ExoPlayer GET then 401s
    // and playback dies on the first segment (this is why Emby "wouldn't play at all"). Pull whatever
    // auth param the stream URL uses and pass it through so the native ResolvingDataSource re-appends
    // it to any segment request that lacks it. Harmless for direct-play (single authed file).
    _streamToken(options) {
        try {
            const m = String(options.url || '').match(/[?&](api_key=[^&]+|ApiKey=[^&]+|X-Plex-Token=[^&]+|X-Emby-Token=[^&]+)/i);
            // Jellyfin/Emby token: pass both names on (Emby needs api_key, Jellyfin 12 ApiKey) so the
            // native player's extra requests (e.g. subtitles) authenticate on either server.
            if (m && /^(api_key|apikey)=/i.test(m[1])) { const t = m[1].slice(m[1].indexOf('=') + 1); return 'api_key=' + t + '&ApiKey=' + t; }
            if (m) return m[1];
        } catch (e) { /* ignore */ }
        return '';
    }

    // Poster/backdrop URL for the lock-screen media card. Plex shim items carry ready-made image URLs;
    // Jellyfin/Emby build one from the item's Primary image tag via their apiClient.
    _artwork(options) {
        const item = (options && options.item) || {};
        try {
            // Plex shim items carry ready-made URLs (already look right on the card).
            if (typeof item.__posterUrl === 'string' && /^https?:/i.test(item.__posterUrl)) return item.__posterUrl;
            if (typeof item.__backdropUrl === 'string' && /^https?:/i.test(item.__backdropUrl)) return item.__backdropUrl;
            const prim = item.ImageTags && item.ImageTags.Primary;
            if (typeof prim === 'string' && /^https?:/i.test(prim)) return prim; // Plex full-URL tag
            const sc = ServerConnections;
            const api = item.ServerId ? sc.getApiClient(item.ServerId) : sc.currentApiClient();
            if (api && item.Id) {
                // Prefer the LANDSCAPE backdrop: the system media card center-crops to a squarish box,
                // which clips a tall portrait poster (the title at the bottom gets cut off). A backdrop
                // fills it cleanly. Fall back to the poster only when there's no backdrop.
                const bd = item.BackdropImageTags;
                if (bd && bd.length) {
                    return api.getUrl('Items/' + item.Id + '/Images/Backdrop/0', {
                        tag: bd[0], api_key: api.accessToken(), fillWidth: 960
                    });
                }
                if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
                    return api.getUrl('Items/' + item.ParentBackdropItemId + '/Images/Backdrop/0', {
                        tag: item.ParentBackdropImageTags[0], api_key: api.accessToken(), fillWidth: 960
                    });
                }
                if (prim) {
                    return api.getUrl('Items/' + item.Id + '/Images/Primary', {
                        tag: prim, api_key: api.accessToken(), fillWidth: 640
                    });
                }
            }
        } catch (e) { /* no artwork */ }
        return '';
    }

    _subtitle(options) {
        const item = (options && options.item) || {};
        if (item.SeriesName) return String(item.SeriesName);
        if (item.ProductionYear) return String(item.ProductionYear);
        return 'Umbry';
    }

    // Artist line for the music lock-screen card.
    _audioArtist(options) {
        const item = (options && options.item) || {};
        if (Array.isArray(item.Artists) && item.Artists.length) return String(item.Artists[0]);
        if (item.AlbumArtist) return String(item.AlbumArtist);
        if (Array.isArray(item.ArtistItems) && item.ArtistItems.length) return String(item.ArtistItems[0].Name || '');
        if (item.Album) return String(item.Album);
        return '';
    }

    // Square album cover for the music media card (Primary image of the album/track).
    _audioArtwork(options) {
        const item = (options && options.item) || {};
        try {
            if (typeof item.__posterUrl === 'string' && /^https?:/i.test(item.__posterUrl)) return item.__posterUrl;
            const prim = item.ImageTags && item.ImageTags.Primary;
            if (typeof prim === 'string' && /^https?:/i.test(prim)) return prim; // Plex full-URL tag
            const sc = ServerConnections;
            const api = item.ServerId ? sc.getApiClient(item.ServerId) : sc.currentApiClient();
            if (api) {
                if (item.AlbumId && item.AlbumPrimaryImageTag) {
                    return api.getUrl('Items/' + item.AlbumId + '/Images/Primary', { tag: item.AlbumPrimaryImageTag, api_key: api.accessToken(), fillWidth: 512 });
                }
                if (item.Id && prim) {
                    return api.getUrl('Items/' + item.Id + '/Images/Primary', { tag: prim, api_key: api.accessToken(), fillWidth: 512 });
                }
            }
        } catch (e) { /* no artwork */ }
        return this._artwork(options);
    }

    async play(options) {
        const nv = nativeVideo();
        if (!nv) { throw new Error('NativeVideo plugin unavailable'); }

        // Jellyfin 12 transcode / HLS URLs carry no token (the web player sends it as a header, which a
        // native player can't). Add it under both names (Emby: api_key, Jellyfin 12: ApiKey) so the stream
        // and its segments authenticate (else 401 on every transcode).
        try {
            const it0 = options.item || {};
            const api0 = it0.ServerId ? ServerConnections.getApiClient(it0.ServerId) : null;
            const u0 = String(options.url || '');
            if (api0 && api0.accessToken && api0.accessToken() && /^https?:/i.test(u0) && !/[?&](api_key|ApiKey|X-Plex-Token|X-Emby-Token)=/i.test(u0)
                && u0.toLowerCase().indexOf(String(api0.serverAddress() || '').toLowerCase()) === 0) {
                const t0 = api0.accessToken();
                options.url = u0 + (u0.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(t0) + '&ApiKey=' + encodeURIComponent(t0);
            }
        } catch (e) { /* keep the URL */ }
        this._playOptions = options;
        this._url = options.url;
        this._started = false;
        this._stopped = false;
        this._paused = false;

        // Resume: for Transcode the server already starts the stream at the resume offset
        // (transcodingOffsetTicks), so start the native player at 0; for direct play/stream we seek.
        // Audio (music, audiobooks) comes as a universal stream URL marked Transcode, but servers usually
        // send the original file and ignore its StartTimeTicks, so audiobooks restarted from 0. For audio
        // the native player seeks to the resume point itself and the URL asks for the start of the file
        // (a server that does transcode then can't apply the offset a second time).
        const isAudioReq = String((options.item && options.item.MediaType) || options.mediaType || '').toLowerCase() === 'audio';
        if (isAudioReq && options.url) { options.url = String(options.url).replace(/([?&]StartTimeTicks=)\d+/i, '$10'); this._url = options.url; }
        const startMs = (options.playMethod === 'Transcode' && !isAudioReq)
            ? 0
            : Math.floor((options.playerStartPositionTicks || 0) / 10000);
        this._currentTimeMs = startMs;
        this._durationMs = 0;

        this._attachNativeListeners();

        const subtitles = this._buildSubtitles(options);
        const queryToken = this._streamToken(options);
        const title = (options.item && (options.item.Name)) || options.title || '';

        const startPromise = new Promise((resolve, reject) => {
            this._resolveStart = resolve;
            this._rejectStart = reject;
        });
        // Don't block playbackManager's start-report indefinitely if the native 'playing' event is missed.
        const timeout = new Promise((resolve) => setTimeout(resolve, 1500));

        // Music routes to the service-owned native audio player (background playback + lock-screen
        // notification); video opens the full-screen native player Activity.
        const isAudio = String((options.item && options.item.MediaType) || options.mediaType || '').toLowerCase() === 'audio';
        this._isAudio = isAudio;
        try {
            if (isAudio) {
                nv.playAudio({
                    url: options.url,
                    startPositionMs: startMs,
                    title: title || 'Umbry',
                    artist: this._audioArtist(options),
                    artworkUrl: this._audioArtwork(options),
                    queryToken: queryToken || ''
                });
            } else {
                this._osdCache = null;
                nv.play({
                    url: options.url,
                    startPositionMs: startMs,
                    title: title,
                    subtitle: this._subtitle(options),
                    artworkUrl: this._artwork(options),
                    subtitles: subtitles,
                    queryToken: queryToken || '',
                    osd: this._osdState(options)
                });
                // People, the next episode and the autoplay setting need server calls: send them when ready.
                this._osdEnrich(options);
            }
        } catch (e) {
            this._finishStopped();
            throw e;
        }

        await Promise.race([startPromise, timeout]);
    }

    stop(destroyPlayer) {
        const nv = nativeVideo();
        try { if (nv) nv.stop(); } catch (e) { /* ignore */ }
        this._finishStopped();
        if (destroyPlayer) { this.destroy(); }
        return Promise.resolve();
    }

    destroy() {
        const nv = nativeVideo();
        try { if (nv) nv.stop(); } catch (e) { /* ignore */ }
        this._detachNativeListeners();
        this._playOptions = null;
    }

    // playbackManager reads position via currentTime() (in ms) and adds transcodingOffsetTicks itself.
    currentTime(val) {
        if (val != null) {
            this._currentTimeMs = val;
            const nv = nativeVideo();
            try { if (nv && nv.seek) nv.seek({ positionMs: Math.floor(val) }); } catch (e) { /* ignore */ }
            return;
        }
        return this._currentTimeMs || 0;
    }

    duration() { return this._durationMs || null; }
    paused() { return this._paused; }

    pause() {
        const nv = nativeVideo();
        try { if (nv && nv.pause) nv.pause(); } catch (e) { /* ignore */ }
        this._paused = true;
    }

    unpause() {
        const nv = nativeVideo();
        try { if (nv && nv.resume) nv.resume(); } catch (e) { /* ignore */ }
        this._paused = false;
    }

    resume() { return this.unpause(); }

    getVolume() { return this._volume; }

    setVolume(val) {
        this._volume = val;
        const nv = nativeVideo();
        try { if (nv && nv.setVolume) nv.setVolume({ level: Math.max(0, Math.min(1, val / 100)) }); } catch (e) { /* ignore */ }
        Events.trigger(this, 'volumechange');
    }

    isMuted() { return this._muted; }

    setMute(mute) {
        this._muted = mute;
        const nv = nativeVideo();
        const lvl = mute ? 0 : Math.max(0, Math.min(1, this._volume / 100));
        try { if (nv && nv.setVolume) nv.setVolume({ level: lvl }); } catch (e) { /* ignore */ }
        Events.trigger(this, 'volumechange');
    }

    getBufferedRanges() { return []; }
    seekable() { return true; }
    currentSrc() { return this._url; }

    canPlayMediaType(mediaType) {
        const t = String(mediaType || '').toLowerCase();
        return hasNative() && (t === 'video' || t === 'audio');
    }

    supportsPlayMethod() { return true; }

    // Direct play/stream: the file carries every audio track, so the native player switches itself.
    // A transcode carries one, so playbackManager re-requests the stream (a fresh play()).
    canSetAudioStreamIndex() {
        return !!(this._playOptions && this._playOptions.playMethod !== 'Transcode');
    }

    _streams(type) {
        const ms = (this._playOptions && this._playOptions.mediaSource) || {};
        return (ms.MediaStreams || []).filter(s => s.Type === type);
    }

    setAudioStreamIndex(index) {
        const nv = nativeVideo();
        const list = this._streams('Audio').filter(s => !s.IsExternal);
        const ord = list.findIndex(s => s.Index === index);
        if (nv && nv.selectTrack && ord >= 0) { try { nv.selectTrack({ type: 'audio', ordinal: ord }); } catch (e) { /* ignore */ } }
        this._pushOsd({ audioIndex: index });
    }

    // playbackManager calls this with -1 (off) or a track the player shows itself: one inside the file
    // (direct play) or a separate subtitle file (External delivery).
    setSubtitleStreamIndex(index) {
        const nv = nativeVideo();
        if (!nv) return;
        if (index == null || index < 0) {
            try { nv.selectTrack({ type: 'text', ordinal: -1 }); } catch (e) { /* ignore */ }
            this._pushOsd({ subtitleIndex: -1 });
            return;
        }
        const s = this._streams('Subtitle').find(x => x.Index === index);
        if (!s) return;
        if (s.DeliveryMethod === 'External' || s.IsExternal) {
            const item = (this._playOptions && this._playOptions.item) || {};
            const api = item.ServerId ? ServerConnections.getApiClient(item.ServerId) : ServerConnections.currentApiClient();
            let url = s.DeliveryUrl || '';
            if (url && !/^https?:/i.test(url) && api) url = api.getUrl(url.replace(/^\//, ''));
            if (url && api && !/[?&](api_key|ApiKey)=/i.test(url)) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + api.accessToken() + '&ApiKey=' + api.accessToken();
            try { nv.setExternalSubtitle({ url, format: (s.Codec || url.split('?')[0].split('.').pop() || ''), lang: s.Language || '', label: s.DisplayTitle || '' }); } catch (e) { /* ignore */ }
        } else {
            const ord = this._streams('Subtitle').filter(x => !x.IsExternal && x.DeliveryMethod !== 'External').findIndex(x => x.Index === index);
            try { nv.selectTrack({ type: 'text', ordinal: ord }); } catch (e) { /* ignore */ }
        }
        this._pushOsd({ subtitleIndex: index });
    }

    // ===== Umbry controls (native UmbryOsd): state in, picks out =====

    _labels() {
        const keys = ['Back', 'Play', 'Pause', 'Previous', 'Rewind', 'Fast forward', 'Mute', 'More', 'Picture in picture',
            'Favorite', 'Playback speed', 'Chapters', 'Subtitle Track', 'Audio Track', 'Cast & Crew', 'Bitrate',
            'Aspect ratio', 'Rotation lock', 'Playback Information', 'Cancel', 'Close', 'Off', 'Auto', 'Cover', 'Fill',
            'No chapters.', 'No cast information.', 'None available', 'Ends at %s', 'Next Episode', 'Next Video',
            '%1$s playing in %2$s seconds', 'Start Now', 'Hide'];
        const out = {};
        keys.forEach(k => { out[k] = jpxT(k); });
        return out;
    }

    _accent() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--jpx-t-accent').trim()
                || getComputedStyle(document.documentElement).getPropertyValue('--jpx-accent').trim();
            if (/^#[0-9a-f]{6}$/i.test(v)) return v;
            const m = v.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i);
            if (m) return '#' + [m[1], m[2], m[3]].map(x => ('0' + parseInt(x, 10).toString(16)).slice(-2)).join('');
        } catch (e) { /* default */ }
        return '#9385F5';
    }

    _pref(k, d) {
        try { const v = localStorage.getItem('jpx-pref-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    }

    _osdState(options) {
        const item = options.item || {};
        const ms = options.mediaSource || {};
        let api = null;
        try { api = item.ServerId ? ServerConnections.getApiClient(item.ServerId) : null; } catch (e) { api = null; }
        const isPlex = !!(item.__plex || /^plex/i.test(String(item.ServerId || '')));
        let logoUrl = '';
        try {
            if (api && item.ImageTags && item.ImageTags.Logo) logoUrl = api.getScaledImageUrl(item.Id, { type: 'Logo', maxWidth: 500, tag: item.ImageTags.Logo });
            else if (api && item.ParentLogoItemId && item.ParentLogoImageTag) logoUrl = api.getScaledImageUrl(item.ParentLogoItemId, { type: 'Logo', maxWidth: 500, tag: item.ParentLogoImageTag });
        } catch (e) { logoUrl = ''; }
        const audio = this._streams('Audio').map((t, n) => ({
            index: t.Index,
            title: (n + 1) + ' - ' + (t.DisplayTitle || t.Language || ('Track ' + (n + 1))),
            sub: [t.Language, (t.Codec || '').toUpperCase(), t.Channels ? t.Channels + 'ch' : ''].filter(Boolean).join(' · ')
        }));
        const subtitles = this._streams('Subtitle').map((t, n) => {
            const lang = t.DisplayLanguage || t.Language || t.Title || 'Unknown';
            const codec = (t.Codec || '').toUpperCase();
            return { index: t.Index, title: (n + 1) + ' - ' + lang + (codec ? ' (' + codec + ')' : ''), sub: [codec, t.IsExternal ? 'External' : 'Embedded'].filter(Boolean).join(' · ') };
        });
        const curA = (options.audioStreamIndex != null) ? options.audioStreamIndex : ms.DefaultAudioStreamIndex;
        const curS = (options.subtitleStreamIndex != null) ? options.subtitleStreamIndex : ms.DefaultSubtitleStreamIndex;
        const chapters = (item.Chapters || []).map((c, i) => ({ name: c.Name || ('Chapter ' + (i + 1)), ms: Math.round((c.StartPositionTicks || 0) / 10000) }));
        const v = (ms.MediaStreams || []).find(x => x.Type === 'Video');
        const fps = v && (v.RealFrameRate || v.AverageFrameRate);
        const info = [
            { group: jpxT('Playback') },
            { k: jpxT('File Name'), v: ms.Path ? String(ms.Path).split(/[\\/]/).pop() : (item.Name || '') },
            { k: jpxT('Play Method'), v: options.playMethod === 'DirectPlay' ? jpxT('Direct Play') : (options.playMethod === 'DirectStream' ? jpxT('Direct Stream') : jpxT(options.playMethod || '')) },
            { k: jpxT('Player'), v: 'Umbry Native Player' },
            { k: jpxT('Container'), v: ms.Container ? String(ms.Container).toUpperCase() : '' },
            { k: jpxT('Bitrate'), v: ms.Bitrate ? (ms.Bitrate / 1000000).toFixed(1) + ' Mbps' : '' }
        ];
        if (v) {
            info.push({ group: jpxT('Video') });
            info.push({ k: jpxT('Resolution'), v: v.Width && v.Height ? v.Width + '×' + v.Height + (fps ? ' @ ' + Math.round(fps) + 'fps' : '') : '@resolution' });
            info.push({ k: jpxT('Codec'), v: v.Codec ? String(v.Codec).toUpperCase() : '' });
            info.push({ k: jpxT('Range'), v: v.VideoRange || '' });
        }
        let bitrate = 'auto';
        try { bitrate = localStorage.getItem('jpx-osd-bitrate') || 'auto'; } catch (e) { /* ignore */ }
        const pbt = {};
        ['above', 'below'].forEach(w => ['left', 'center', 'right'].forEach(sl => {
            const def = { above_right: 'endsat', below_left: 'elapsed', below_right: 'duration' }[w + '_' + sl] || 'none';
            pbt[w + '_' + sl] = this._pref('pbt_' + w + '_' + sl, def);
        }));
        const st = {
            title: item.Name || options.title || '',
            logoUrl,
            itemId: item.Id || '',
            serverId: item.ServerId || '',
            supportsFavorites: !isPlex,
            isFavorite: !!(item.UserData && item.UserData.IsFavorite),
            isEpisode: item.Type === 'Episode',
            isTv: document.documentElement.classList.contains('jpx-tv'),
            isLocal: /^(file|content):/i.test(String(options.url || '')),
            accent: this._accent(),
            skipBack: userSettings.skipBackLength(),
            skipFwd: userSettings.skipForwardLength(),
            upNextEnabled: userSettings.enableNextVideoInfoOverlay(),
            autoplay: true,
            pbt,
            buttons: this._pref('osdButtons', null) || {},
            labels: this._labels(),
            audio,
            subtitles,
            audioIndex: curA == null ? -1 : curA,
            subtitleIndex: curS == null ? -1 : curS,
            chapters,
            people: this._people(item, api),
            info,
            bitrate
        };
        this._osdCache = st;
        return st;
    }

    _people(item, api) {
        return (item.People || []).slice(0, 24).map(p => ({
            id: p.Id, name: p.Name || '', role: p.Role || p.Type || '',
            img: (p.PrimaryImageTag && api) ? api.getScaledImageUrl(p.Id, { type: 'Primary', maxHeight: 220, tag: p.PrimaryImageTag }) : ''
        }));
    }

    async _osdEnrich(options) {
        const item = options.item || {};
        let api = null;
        try { api = item.ServerId ? ServerConnections.getApiClient(item.ServerId) : null; } catch (e) { api = null; }
        const patch = {};
        try {
            if (api && item.Id && !(item.People && item.People.length) && !item.__plex) {
                const full = await api.getItem(api.getCurrentUserId(), item.Id);
                if (full) {
                    patch.people = this._people(full, api);
                    if (!(item.Chapters && item.Chapters.length) && full.Chapters) patch.chapters = full.Chapters.map((c, i) => ({ name: c.Name || ('Chapter ' + (i + 1)), ms: Math.round((c.StartPositionTicks || 0) / 10000) }));
                    patch.isFavorite = !!(full.UserData && full.UserData.IsFavorite);
                }
            }
        } catch (e) { /* keep what we have */ }
        try {
            if (api && !item.__plex) {
                const user = await api.getCurrentUser();
                patch.autoplay = !!(user && user.Configuration && user.Configuration.EnableNextEpisodeAutoPlay !== false);
            }
        } catch (e) { /* default on */ }
        this._pushOsd(patch);
    }

    // The next title for Up Next. playbackManager fills its queue only once playback has started, so
    // this runs after the native player reports it is playing (and again a little later).
    _pushUpNext() {
        try {
            const next = playbackManager.getNextItem();
            const n = next && next.item;
            if (!n) return false;
            this._pushOsd({
                upNext: {
                    title: n.SeriesName ? n.SeriesName + ' - ' + (n.Name || '') : (n.Name || ''),
                    info: [n.ProductionYear, n.OfficialRating, n.RunTimeTicks ? Math.round(n.RunTimeTicks / 600000000) + 'm' : ''].filter(Boolean).join('   '),
                    episode: n.Type === 'Episode'
                }
            });
            return true;
        } catch (e) { return false; }
    }

    _pushOsd(patch) {
        if (!this._osdCache) return;
        Object.assign(this._osdCache, patch || {});
        const nv = nativeVideo();
        try { if (nv && nv.updateOsd) nv.updateOsd({ osd: this._osdCache }); } catch (e) { /* ignore */ }
    }

    _onOsd(d) {
        const action = d.action;
        const value = d.value;
        try { inputManager.notify(); } catch (e) { /* ignore */ }   // keeps Still Watching from counting this as idle
        const item = (this._playOptions && this._playOptions.item) || {};
        let api = null;
        try { api = item.ServerId ? ServerConnections.getApiClient(item.ServerId) : null; } catch (e) { api = null; }
        switch (action) {
            case 'favorite': {
                if (!api || !item.Id) return;
                const target = !(this._osdCache && this._osdCache.isFavorite);
                this._pushOsd({ isFavorite: target });
                Promise.resolve(api.updateFavoriteStatus(api.getCurrentUserId(), item.Id, target)).then(() => {
                    item.UserData = item.UserData || {};
                    item.UserData.IsFavorite = target;
                }).catch(() => this._pushOsd({ isFavorite: !target }));
                return;
            }
            case 'audio':
                try { playbackManager.setAudioStreamIndex(parseInt(value, 10), this); } catch (e) { /* ignore */ }
                return;
            case 'subtitle':
                try { playbackManager.setSubtitleStreamIndex(parseInt(value, 10), this); } catch (e) { /* ignore */ }
                return;
            case 'bitrate':
                try { localStorage.setItem('jpx-osd-bitrate', value); } catch (e) { /* ignore */ }
                this._pushOsd({ bitrate: value });
                try {
                    playbackManager.setMaxStreamingBitrate({
                        enableAutomaticBitrateDetection: value === 'auto',
                        maxBitrate: value === 'auto' ? null : parseInt(value, 10)
                    }, this);
                } catch (e) { /* ignore */ }
                return;
            case 'person': {
                const sid = item.ServerId;
                try { playbackManager.stop(this); } catch (e) { /* ignore */ }
                setTimeout(() => { try { appRouter.show('/details?id=' + encodeURIComponent(value) + (sid ? '&serverId=' + sid : '')); } catch (e) { /* ignore */ } }, 300);
                return;
            }
            case 'upnext':
                try { playbackManager.nextTrack(this); } catch (e) { /* ignore */ }
                return;
            default:
        }
    }

    supports() { return false; }

    async getDeviceProfile(item, options) {
        try {
            const nv = nativeVideo();
            if (nv && nv.getCodecs) {
                const caps = await nv.getCodecs();
                const prof = buildNativeProfile(caps);
                if (prof) return prof;
            }
        } catch (e) { /* fall through to the stock profile */ }
        // Fallback (device query unavailable): the stock browser profile — always works, just transcodes
        // more (and seeks worse) than a device-accurate profile.
        if (appHost.getDeviceProfile) {
            return appHost.getDeviceProfile(item, options);
        }
        return profileBuilder({});
    }
}

export default JpxNativeVideoPlayer;
