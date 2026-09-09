import { PluginType } from 'constants/pluginType';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { appHost } from '../../components/apphost';
import profileBuilder from '../../scripts/browserDeviceProfile';
import Events from '../../utils/events.ts';

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
            { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '6', MinSegments: '1', BreakOnNonKeyFrames: true }
        ],
        ContainerProfiles: [],
        CodecProfiles: [],
        // Direct-play keeps embedded subs inside the container -> the native CC button reads them.
        SubtitleProfiles: [
            { Format: 'srt', Method: 'Embed' }, { Format: 'subrip', Method: 'Embed' },
            { Format: 'ass', Method: 'Embed' }, { Format: 'ssa', Method: 'Embed' },
            { Format: 'pgssub', Method: 'Embed' }, { Format: 'dvdsub', Method: 'Embed' },
            { Format: 'vtt', Method: 'Embed' }, { Format: 'sub', Method: 'Embed' }
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
            Events.trigger(this, 'error', [{ type: 'mediadecodeerror', message: d && d.message }]);
            if (!this._started && this._rejectStart) {
                const rej = this._rejectStart;
                this._rejectStart = null; this._resolveStart = null;
                rej(new Error((d && d.message) || 'native playback error'));
            }
            this._finishStopped();
        });
        // The user closed the native player (back button) -> treat as a stop so playbackManager saves
        // the resume position and runs its stop reporting.
        add('dismiss', (d) => {
            if (d && typeof d.positionMs === 'number') { this._currentTimeMs = d.positionMs; }
            this._finishStopped();
        });
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
            const m = String(options.url || '').match(/[?&](api_key=[^&]+|X-Plex-Token=[^&]+|X-Emby-Token=[^&]+)/i);
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

        this._playOptions = options;
        this._url = options.url;
        this._started = false;
        this._stopped = false;
        this._paused = false;

        // Resume: for Transcode the server already starts the stream at the resume offset
        // (transcodingOffsetTicks), so start the native player at 0; for direct play/stream we seek.
        const startMs = options.playMethod === 'Transcode'
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
                nv.play({
                    url: options.url,
                    startPositionMs: startMs,
                    title: title,
                    subtitle: this._subtitle(options),
                    artworkUrl: this._artwork(options),
                    subtitles: subtitles,
                    queryToken: queryToken || ''
                });
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
    canSetAudioStreamIndex() { return false; }

    // Track switching that needs a re-transcode arrives as a fresh play() with a new options.url; the
    // native player's own controller handles picking among the tracks already in the stream.
    setSubtitleStreamIndex() { /* handled natively / via new play() */ }
    setAudioStreamIndex() { /* handled via new play() for transcode */ }

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
