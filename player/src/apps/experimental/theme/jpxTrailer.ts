// Umbry — shared trailer element builder for the Local Previews / Media Bar features. Prefers a
// LOCAL trailer file (a <video> streamed from the server — no embed restrictions). Otherwise it
// plays the item's YouTube RemoteTrailer through the YouTube IFrame Player API (YT.Player) — the same
// path Jellyfin's built-in youtubePlayer plugin (and Moonfin) use. A raw <iframe src="…/embed/…">
// hits YouTube's "Video player error / Watch on YouTube" screen for many videos; the IFrame API
// (which adds enablejsapi + an origin/referrer handshake) plays them. Resolves null if neither exists.
//
// The returned element gets a `<className>--playing` class the moment real playback starts, so the
// caller can reveal it only once it's playing (hiding the player's load/controls flash). Options let
// the caller disable looping and hook onPlaying / onEnded (used by the hero to time slide rotation).

interface TrailerItem { Id?: string }
interface TrailerApi {
    getCurrentUserId(): string;
    getLocalTrailers(userId: string, itemId: string): Promise<TrailerItem[]>;
    getUrl(path: string, params?: Record<string, unknown>): string;
    accessToken(): string;
}
interface PreviewItem { Id: string; LocalTrailerCount?: number; RemoteTrailers?: Array<{ Url?: string }>; __trailerUrl?: string; __plexServerId?: string }
interface TrailerOpts { loop?: boolean; onPlaying?: () => void; onEnded?: () => void }

// After a YouTube trailer starts, its mobile control overlay shows briefly then auto-hides (no
// interaction -> it fades). Wait this long before revealing the player so those controls never show.
const YT_REVEAL_DELAY_MS = 4500;

/* eslint-disable @typescript-eslint/no-explicit-any */

function ytId(url: string | undefined): string | null {
    const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

// Load the YouTube IFrame Player API once; resolve with the global YT when YT.Player is available.
function ytApiReady(): Promise<any> {
    const w = window as any;
    return new Promise((resolve) => {
        if (w.YT && w.YT.Player) { resolve(w.YT); return; }
        const prev = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = function () {
            if (typeof prev === 'function') { try { prev(); } catch { /* ignore */ } }
            resolve(w.YT);
        };
        if (!document.querySelector('script[data-jpx-yt]')) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.setAttribute('data-jpx-yt', '1');
            (document.head || document.body).appendChild(tag);
        }
    });
}

export async function makeTrailerEl(api: TrailerApi, item: PreviewItem, className: string, muted: boolean, opts: TrailerOpts = {}): Promise<HTMLElement | null> {
    const loop = opts.loop !== false;
    const playingClass = className + '--playing';

    // 0) A pre-resolved direct video URL (e.g. a Plex trailer stream) -> <video>. No controls, so no
    //    YouTube reveal-delay needed; reveal as soon as it starts playing.
    if (item.__trailerUrl) {
        const v = document.createElement('video');
        v.className = className;
        v.src = item.__trailerUrl;
        v.autoplay = true; v.loop = loop; v.muted = muted; v.defaultMuted = muted;
        v.setAttribute('playsinline', '');
        if (muted) v.setAttribute('muted', '');
        v.addEventListener('playing', () => { v.classList.add(playingClass); try { opts.onPlaying?.(); } catch { /* ignore */ } }, { once: true });
        if (!loop) v.addEventListener('ended', () => { try { opts.onEnded?.(); } catch { /* ignore */ } });
        void v.play?.().catch(() => { /* autoplay may be blocked when unmuted */ });
        return v;
    }

    // 1) Local trailer file -> <video> (reliable; no embed policy).
    if ((item.LocalTrailerCount || 0) > 0) {
        try {
            const locals = await api.getLocalTrailers(api.getCurrentUserId(), item.Id);
            const t = locals && locals[0];
            if (t && t.Id) {
                const url = api.getUrl('Videos/' + t.Id + '/stream.mp4', { Static: true, api_key: api.accessToken() });
                const v = document.createElement('video');
                v.className = className;
                v.src = url;
                v.autoplay = true; v.loop = loop; v.muted = muted; v.defaultMuted = muted;
                v.setAttribute('playsinline', '');
                if (muted) v.setAttribute('muted', '');
                v.addEventListener('playing', () => { v.classList.add(playingClass); try { opts.onPlaying?.(); } catch { /* ignore */ } }, { once: true });
                if (!loop) v.addEventListener('ended', () => { try { opts.onEnded?.(); } catch { /* ignore */ } });
                void v.play?.().catch(() => { /* autoplay may be blocked when unmuted */ });
                return v;
            }
        } catch { /* fall through to YouTube */ }
    }
    // 2) YouTube RemoteTrailer -> YT.Player IFrame API (robust where a raw embed errors out).
    const vid = ytId(((item.RemoteTrailers || [])[0] || {}).Url);
    if (vid) {
        const wrap = document.createElement('div');
        wrap.className = className;
        const target = document.createElement('div'); // YT.Player replaces this with its <iframe>
        wrap.appendChild(target);
        // Cover-fit the 16:9 YouTube iframe inside the wide/short hero wrapper so it fills the hero the
        // way the Plex/local <video> does (object-fit:cover). An iframe can't be object-fit, and at
        // 100%×100% YouTube pillarboxes the video with black side bars — so size it to cover in JS.
        wrap.style.overflow = 'hidden';
        const coverFit = () => {
            const iframe = wrap.querySelector('iframe') as HTMLIFrameElement | null;
            if (!iframe) return;
            const w = wrap.clientWidth, h = wrap.clientHeight;
            if (!w || !h) return;
            let iw: number, ih: number;
            if (w / h > 16 / 9) { iw = w; ih = w * 9 / 16; } else { ih = h; iw = h * 16 / 9; }
            iframe.style.position = 'absolute';
            iframe.style.inset = 'auto';
            iframe.style.width = Math.ceil(iw) + 'px';
            iframe.style.height = Math.ceil(ih) + 'px';
            iframe.style.left = Math.round((w - iw) / 2) + 'px';
            iframe.style.top = Math.round((h - ih) / 2) + 'px';
            iframe.style.maxWidth = 'none';
            iframe.style.maxHeight = 'none';
        };
        try { new ResizeObserver(coverFit).observe(wrap); } catch { /* older engines: sized on ready/play */ }
        try {
            const YT = await ytApiReady();
            if (!YT || !YT.Player) return null;
            // eslint-disable-next-line no-new
            let revealed = false;
            new YT.Player(target, {
                width: '100%', height: '100%', videoId: vid,
                playerVars: {
                    autoplay: 1, mute: muted ? 1 : 0, controls: 0, modestbranding: 1, showinfo: 0,
                    rel: 0, fs: 0, playsinline: 1, disablekb: 1, iv_load_policy: 3,
                    loop: loop ? 1 : 0, playlist: vid
                },
                events: {
                    onReady: (e: any) => { try { if (muted) e.target.mute(); e.target.playVideo(); } catch { /* ignore */ } coverFit(); setTimeout(coverFit, 300); },
                    onStateChange: (e: any) => {
                        if (e.data === YT.PlayerState.PLAYING) {
                            coverFit();
                            if (revealed) return;
                            revealed = true;
                            // Reveal only after YouTube's initial control overlay has auto-hidden.
                            setTimeout(() => {
                                wrap.classList.add(playingClass);
                                try { opts.onPlaying?.(); } catch { /* ignore */ }
                            }, YT_REVEAL_DELAY_MS);
                        } else if (e.data === YT.PlayerState.ENDED) {
                            if (loop) { try { e.target.seekTo(0); e.target.playVideo(); } catch { /* ignore */ } }
                            else { try { opts.onEnded?.(); } catch { /* ignore */ } }
                        }
                    }
                }
            });
        } catch { return null; }
        return wrap;
    }
    return null;
}
