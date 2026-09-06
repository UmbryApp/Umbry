// Umbry — custom music player (our own design; Moonfin punts to the server default here).
//
// A full-screen now-playing overlay: ambient blurred-art glow, rounded art, title/artist/album,
// favorite heart, themed scrubber, shuffle/prev/play/next/repeat transport, an Up Next queue
// sheet, and an extras sheet (playback speed chips, sleep timer, save queue as playlist).
// All state/actions delegate to playbackManager; UI refreshes on a light poll.

import { playbackManager } from 'components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import './jpxMusicPlayer.scss';

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return m + ':' + String(s).padStart(2, '0');
}
// Progress Bar Time (music): what the RIGHT label shows (jpx-pref-pbt_music, from Settings >
// Video Playback > Progress Bar Time > Music Player). Left label always shows elapsed.
function mpPref(k, d) { try { const v = localStorage.getItem('jpx-pref-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function durLabel(cur, dur) {
    switch (mpPref('pbt_music', 'duration')) {
        case 'elapsed': return fmt(cur);
        case 'remaining': return dur > 0 ? '-' + fmt(dur - cur) : '';
        case 'endsat': { if (dur <= 0) return ''; const end = new Date(Date.now() + Math.max(0, dur - cur) * 1000); return 'Ends at ' + end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
        case 'none': return '';
        default: return fmt(dur);
    }
}

let host = null;
let pollTimer = null;
let sleepAt = null; // epoch ms, or 'track'
let sleepLabel = 'Off';

function player() { return playbackManager.getCurrentPlayer(); }
function np() { try { return playbackManager.getPlayerState(player()).NowPlayingItem; } catch (e) { return null; } }

// Umbry — Emby is stricter than Jellyfin/Plex about a device's lingering transcode session:
// after music stops, a leftover Emby session makes the NEXT video (hero Play) fail with a
// generic fatal player error. Explicitly stop this session's server-side encodings on stop
// so the next play on Emby starts clean. Harmless on Jellyfin/Plex (no-op if nothing lingers).
function jpxStopMusic() {
    // Plain stop (reverted the v0.8.6 stopActiveEncodings experiment: it did NOT fix the Emby
    // music->hero fatal error and it REGRESSED Jellyfin — movie audio played over a stale backdrop.
    // The real fix for the music->video transition is pending a real repro/diagnosis.)
    try { playbackManager.stop(player()); } catch (e) { /* ignore */ }
}

export function openJpxMusicPlayer() {
    if (host) { host.classList.remove('jpx-mp-closed'); refresh(true); return; }
    host = document.createElement('div');
    host.className = 'jpx-mp';
    host.innerHTML =
        '<div class="jpx-mp-glow"></div>'
        + '<div class="jpx-mp-scrim"></div>'
        + '<div class="jpx-mp-head">'
        + '<button type="button" class="jpx-mp-close"><span class="material-icons" aria-hidden="true">expand_more</span></button>'
        + '<button type="button" class="jpx-mp-more"><span class="material-icons" aria-hidden="true">more_vert</span></button>'
        + '</div>'
        + '<div class="jpx-mp-art"></div>'
        + '<div class="jpx-mp-title"></div>'
        + '<div class="jpx-mp-artist"></div>'
        + '<div class="jpx-mp-album"></div>'
        + '<button type="button" class="jpx-mp-fav"><span class="material-icons" aria-hidden="true">favorite_border</span></button>'
        + '<div class="jpx-mp-slider-wrap">'
        + '<input type="range" class="jpx-mp-slider" min="0" max="1000" value="0" step="1" />'
        + '<div class="jpx-mp-times"><span class="jpx-mp-cur">0:00</span><span class="jpx-mp-dur">0:00</span></div>'
        + '</div>'
        + '<div class="jpx-mp-transport">'
        + '<button type="button" class="jpx-mp-shuffle"><span class="material-icons" aria-hidden="true">shuffle</span></button>'
        + '<button type="button" class="jpx-mp-prev"><span class="material-icons" aria-hidden="true">skip_previous</span></button>'
        + '<button type="button" class="jpx-mp-play"><span class="material-icons" aria-hidden="true">pause</span></button>'
        + '<button type="button" class="jpx-mp-next"><span class="material-icons" aria-hidden="true">skip_next</span></button>'
        + '<button type="button" class="jpx-mp-repeat"><span class="material-icons" aria-hidden="true">repeat</span></button>'
        + '</div>'
        + '<div class="jpx-mp-vol"><span class="material-icons jpx-mp-vol-ic" aria-hidden="true">volume_up</span><input type="range" class="jpx-mp-vol-slider" min="0" max="100" step="1" value="100" /></div>'
        + '<button type="button" class="jpx-mp-upnext">Up Next</button>';
    document.body.appendChild(host);

    const q = (sel) => host.querySelector(sel);
    q('.jpx-mp-close').addEventListener('click', closeJpxMusicPlayer);
    q('.jpx-mp-play').addEventListener('click', () => { try { playbackManager.playPause(player()); } catch (e) { /* ignore */ } });
    q('.jpx-mp-next').addEventListener('click', () => { try { playbackManager.nextTrack(player()); } catch (e) { /* ignore */ } });
    q('.jpx-mp-prev').addEventListener('click', () => { try { playbackManager.previousTrack(player()); } catch (e) { /* ignore */ } });
    q('.jpx-mp-shuffle').addEventListener('click', () => { try { playbackManager.toggleQueueShuffleMode(player()); } catch (e) { /* ignore */ } setTimeout(() => refresh(false), 150); });
    q('.jpx-mp-repeat').addEventListener('click', () => {
        try {
            const cur = playbackManager.getRepeatMode(player());
            const next = cur === 'RepeatNone' ? 'RepeatAll' : (cur === 'RepeatAll' ? 'RepeatOne' : 'RepeatNone');
            playbackManager.setRepeatMode(next, player());
        } catch (e) { /* ignore */ }
        setTimeout(() => refresh(false), 150);
    });
    q('.jpx-mp-fav').addEventListener('click', () => {
        const it = np();
        if (!it || !it.ServerId) return;
        const ac = ServerConnections.getApiClient(it.ServerId);
        const cur = !!(it.UserData && it.UserData.IsFavorite);
        Promise.resolve(ac.updateFavoriteStatus(ac.getCurrentUserId(), it.Id, !cur)).then(() => {
            it.UserData = it.UserData || {}; it.UserData.IsFavorite = !cur; refresh(false);
        }).catch(() => { /* ignore */ });
    });
    const slider = q('.jpx-mp-slider');
    slider.addEventListener('input', () => { slider.__seeking = true; });
    slider.addEventListener('change', () => {
        try { playbackManager.seekPercent(slider.value / 10, player()); } catch (e) { /* ignore */ }
        slider.__seeking = false;
    });
    q('.jpx-mp-upnext').addEventListener('click', openQueueSheet);
    q('.jpx-mp-more').addEventListener('click', openExtrasSheet);
    const volSlider = q('.jpx-mp-vol-slider');
    volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10) || 0;
        try { if (playbackManager.isMuted(player()) && v > 0) playbackManager.setMute(false, player()); playbackManager.setVolume(v, player()); } catch (e) { /* ignore */ }
        volSlider.style.setProperty('--v', v + '%');
        q('.jpx-mp-vol-ic').textContent = v <= 0 ? 'volume_off' : (v < 45 ? 'volume_down' : 'volume_up');
    });
    q('.jpx-mp-vol-ic').addEventListener('click', () => { try { playbackManager.toggleMute(player()); } catch (e) { /* ignore */ } setTimeout(() => refresh(false), 40); });

    pollTimer = setInterval(() => refresh(false), 600);
    refresh(true);
}

export function closeJpxMusicPlayer() {
    if (host) host.classList.add('jpx-mp-closed');
}

function destroy() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (host) { try { host.remove(); } catch (e) { /* ignore */ } host = null; }
}

function refresh(full) {
    if (!host) return;
    const it = np();
    if (!it) { destroy(); return; }
    // stop on sleep timer
    if (sleepAt && sleepAt !== 'track' && Date.now() >= sleepAt) {
        sleepAt = null; sleepLabel = 'Off';
        jpxStopMusic();
        return;
    }
    const q = (sel) => host.querySelector(sel);
    if (full || host.__itemId !== it.Id) {
        // track changed: if sleep = end-of-track and it flipped, stop now
        if (host.__itemId && sleepAt === 'track') {
            sleepAt = null; sleepLabel = 'Off';
            jpxStopMusic();
            return;
        }
        host.__itemId = it.Id;
        const ac = it.ServerId ? ServerConnections.getApiClient(it.ServerId) : null;
        let art = null;
        try {
            const tag = (it.ImageTags && it.ImageTags.Primary) || it.AlbumPrimaryImageTag;
            const id = (it.ImageTags && it.ImageTags.Primary) ? it.Id : it.AlbumId;
            if (ac && tag && id) art = ac.getScaledImageUrl(id, { type: 'Primary', maxWidth: 720, tag: tag });
        } catch (e) { /* ignore */ }
        q('.jpx-mp-art').style.backgroundImage = art ? "url('" + art + "')" : '';
        q('.jpx-mp-glow').style.backgroundImage = art ? "url('" + art + "')" : '';
        q('.jpx-mp-title').textContent = it.Name || '';
        q('.jpx-mp-artist').textContent = (it.Artists && it.Artists.join(', ')) || it.AlbumArtist || '';
        q('.jpx-mp-album').textContent = it.Album || '';
    }
    const fav = !!(it.UserData && it.UserData.IsFavorite);
    q('.jpx-mp-fav .material-icons').textContent = fav ? 'favorite' : 'favorite_border';
    q('.jpx-mp-fav').classList.toggle('on', fav);
    let paused = false, pct = 0, cur = 0, dur = 0;
    try {
        const state = playbackManager.getPlayerState(player());
        paused = !!(state.PlayState && state.PlayState.IsPaused);
        const pos = (state.PlayState && state.PlayState.PositionTicks) || 0;
        const rt = it.RunTimeTicks || 0;
        cur = pos / 10000000; dur = rt / 10000000;
        pct = rt ? (pos / rt) * 1000 : 0;
    } catch (e) { /* ignore */ }
    q('.jpx-mp-play .material-icons').textContent = paused ? 'play_arrow' : 'pause';
    const slider = q('.jpx-mp-slider');
    if (!slider.__seeking) {
        slider.value = pct;
        slider.style.setProperty('--pct', (pct / 10) + '%');
    }
    q('.jpx-mp-cur').textContent = fmt(cur);
    q('.jpx-mp-dur').textContent = durLabel(cur, dur);
    try {
        const sh = playbackManager.getQueueShuffleMode(player());
        q('.jpx-mp-shuffle').classList.toggle('on', sh === 'Shuffle');
    } catch (e) { /* ignore */ }
    try {
        const rp = playbackManager.getRepeatMode(player());
        q('.jpx-mp-repeat').classList.toggle('on', rp !== 'RepeatNone');
        q('.jpx-mp-repeat .material-icons').textContent = rp === 'RepeatOne' ? 'repeat_one' : 'repeat';
    } catch (e) { /* ignore */ }
    try {
        const vs = q('.jpx-mp-vol-slider'), vi = q('.jpx-mp-vol-ic');
        if (vs && vi) {
            const m = playbackManager.isMuted(player());
            const vv = Math.round(playbackManager.getVolume(player()) || 0);
            if (document.activeElement !== vs) vs.value = m ? 0 : vv;
            vs.style.setProperty('--v', (m ? 0 : vv) + '%');
            vi.textContent = (m || vv <= 0) ? 'volume_off' : (vv < 45 ? 'volume_down' : 'volume_up');
        }
    } catch (e) { /* ignore */ }
}

// ---------- frosted sheets ----------
function sheet(title, bodyHtml) {
    const ov = document.createElement('div');
    ov.className = 'jpx-mp-overlay';
    ov.innerHTML = '<div class="jpx-mp-card"><div class="jpx-mp-card-title">' + esc(title) + '</div>'
        + '<div class="jpx-mp-card-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(ov);
    const close = () => { try { ov.remove(); } catch (e) { /* ignore */ } };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    return { ov, close };
}

function openQueueSheet() {
    let list = [];
    try { list = playbackManager.getPlaylist(player()) || []; } catch (e) { /* ignore */ }
    const it = np();
    Promise.resolve(list).then(items => {
        const rows = (items || []).map((t, i) => {
            const curRow = it && t.Id === it.Id;
            return '<button type="button" class="jpx-mp-qrow' + (curRow ? ' now' : '') + '" data-i="' + i + '" data-pl="' + esc(t.PlaylistItemId || '') + '">'
                + '<span class="jpx-mp-qnum">' + (curRow ? '<span class="jpx-mp-eq"><i></i><i></i><i></i></span>' : (i + 1)) + '</span>'
                + '<span class="jpx-mp-qbody"><span class="jpx-mp-qname">' + esc(t.Name) + '</span>'
                + '<span class="jpx-mp-qsub">' + esc((t.Artists && t.Artists.join(', ')) || t.AlbumArtist || '') + (t.RunTimeTicks ? ' • ' + fmt(t.RunTimeTicks / 10000000) : '') + '</span></span></button>';
        }).join('');
        const s = sheet('Up Next', rows || '<div class="jpx-mp-empty">Queue is empty.</div>');
        s.ov.querySelectorAll('.jpx-mp-qrow').forEach(b => b.addEventListener('click', () => {
            try {
                const pl = b.getAttribute('data-pl');
                if (pl) playbackManager.setCurrentPlaylistItem(pl, player());
            } catch (e) { /* ignore */ }
            s.close();
        }));
    });
}

function openExtrasSheet() {
    let rate = 1;
    try { rate = playbackManager.getPlaybackRate(player()) || 1; } catch (e) { /* ignore */ }
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const chips = (arr, cur, cls, fmtFn) => arr.map(v =>
        '<button type="button" class="jpx-mp-chip ' + cls + (v === cur ? ' on' : '') + '" data-v="' + v + '">'
        + (v === cur ? '<span class="material-icons" aria-hidden="true">check</span>' : '') + fmtFn(v) + '</button>').join('');
    const s = sheet('Player options',
        '<div class="jpx-mp-group">Playback speed</div>'
        + '<div class="jpx-mp-chips">' + chips(rates, rate, 'jpx-mp-rate', v => (v === 0.75 ? '0.75' : Number(v).toFixed(v % 1 ? 2 : 1)) + 'x') + '</div>'
        + '<div class="jpx-mp-group">Sleep timer</div>'
        + '<div class="jpx-mp-chips">'
        + ['Off', '15 min', '30 min', '60 min', 'End of track'].map(l =>
            '<button type="button" class="jpx-mp-chip jpx-mp-sleep' + (l === sleepLabel ? ' on' : '') + '" data-l="' + l + '">'
            + (l === sleepLabel ? '<span class="material-icons" aria-hidden="true">check</span>' : '') + l + '</button>').join('')
        + '</div>'
        + '<button type="button" class="jpx-mp-saveq"><span class="material-icons" aria-hidden="true">playlist_add</span>Save queue as playlist</button>');
    s.ov.querySelectorAll('.jpx-mp-rate').forEach(b => b.addEventListener('click', () => {
        try { playbackManager.setPlaybackRate(parseFloat(b.getAttribute('data-v')), player()); } catch (e) { /* ignore */ }
        s.close();
    }));
    s.ov.querySelectorAll('.jpx-mp-sleep').forEach(b => b.addEventListener('click', () => {
        const l = b.getAttribute('data-l');
        sleepLabel = l;
        if (l === 'Off') sleepAt = null;
        else if (l === 'End of track') sleepAt = 'track';
        else sleepAt = Date.now() + parseInt(l, 10) * 60000;
        s.close();
    }));
    s.ov.querySelector('.jpx-mp-saveq').addEventListener('click', () => {
        try {
            const items = playbackManager.getPlaylist(player()) || [];
            const it = np();
            if (!items.length || !it || !it.ServerId) { s.close(); return; }
            const ac = ServerConnections.getApiClient(it.ServerId);
            const name = 'Umbry Queue ' + new Date().toLocaleDateString();
            ac.ajax({
                type: 'POST',
                url: ac.getUrl('Playlists'),
                data: JSON.stringify({ Name: name, Ids: items.map(x => x.Id), UserId: ac.getCurrentUserId(), MediaType: 'Audio' }),
                contentType: 'application/json'
            }).then(() => { s.close(); }).catch(() => { s.close(); });
        } catch (e) { s.close(); }
    });
}

// =====================================================================================
// Persistent mini player: a floating frosted pill under the nav (Moonfin has one too) that
// follows every screen while audio plays — art, title, prev/play/next/stop; tap = full player.
// Replaces the stock bottom nowPlayingBar for audio (hidden via body.jpx-music-active CSS).
// =====================================================================================
let pill = null;
let pillPoll = null;

function showPill() {
    document.body.classList.add('jpx-music-active');
    if (pill) return;
    pill = document.createElement('div');
    pill.className = 'jpx-mpill';
    pill.innerHTML =
        '<div class="jpx-mpill-art"></div>'
        + '<div class="jpx-mpill-txt"></div>'
        + '<button type="button" class="jpx-mpill-prev"><span class="material-icons" aria-hidden="true">skip_previous</span></button>'
        + '<button type="button" class="jpx-mpill-play"><span class="material-icons" aria-hidden="true">pause</span></button>'
        + '<button type="button" class="jpx-mpill-next"><span class="material-icons" aria-hidden="true">skip_next</span></button>'
        + '<button type="button" class="jpx-mpill-stop"><span class="material-icons" aria-hidden="true">stop</span></button>';
    document.body.appendChild(pill);
    pill.addEventListener('click', (e) => { if (!e.target.closest('button')) openJpxMusicPlayer(); });
    pill.querySelector('.jpx-mpill-prev').addEventListener('click', () => { try { playbackManager.previousTrack(player()); } catch (e) { /* ignore */ } });
    pill.querySelector('.jpx-mpill-play').addEventListener('click', () => { try { playbackManager.playPause(player()); } catch (e) { /* ignore */ } });
    pill.querySelector('.jpx-mpill-next').addEventListener('click', () => { try { playbackManager.nextTrack(player()); } catch (e) { /* ignore */ } });
    pill.querySelector('.jpx-mpill-stop').addEventListener('click', () => { jpxStopMusic(); });
    pillPoll = setInterval(refreshPill, 800);
    refreshPill();
}

function hidePill() {
    document.body.classList.remove('jpx-music-active');
    if (pillPoll) { clearInterval(pillPoll); pillPoll = null; }
    if (pill) { try { pill.remove(); } catch (e) { /* ignore */ } pill = null; }
}

function refreshPill() {
    if (!pill) return;
    const it = np();
    if (!it || it.MediaType !== 'Audio') { hidePill(); destroy(); return; }
    if (pill.__itemId !== it.Id) {
        pill.__itemId = it.Id;
        const ac = it.ServerId ? ServerConnections.getApiClient(it.ServerId) : null;
        let art = null;
        try {
            const tag = (it.ImageTags && it.ImageTags.Primary) || it.AlbumPrimaryImageTag;
            const id = (it.ImageTags && it.ImageTags.Primary) ? it.Id : it.AlbumId;
            if (ac && tag && id) art = ac.getScaledImageUrl(id, { type: 'Primary', maxWidth: 120, tag: tag });
        } catch (e) { /* ignore */ }
        pill.querySelector('.jpx-mpill-art').style.backgroundImage = art ? "url('" + art + "')" : '';
        const artist = (it.Artists && it.Artists[0]) || it.AlbumArtist || '';
        pill.querySelector('.jpx-mpill-txt').textContent = it.Name + (artist ? ' - ' + artist : '');
    }
    try {
        const state = playbackManager.getPlayerState(player());
        const paused = !!(state.PlayState && state.PlayState.IsPaused);
        pill.querySelector('.jpx-mpill-play .material-icons').textContent = paused ? 'play_arrow' : 'pause';
    } catch (e) { /* ignore */ }
}

let miniInit = false;
export function initJpxMusicMiniBar() {
    if (miniInit) return;
    miniInit = true;
    import('utils/events').then(({ default: Events }) => {
        Events.on(playbackManager, 'playbackstart', () => {
            const it = np();
            if (it && it.MediaType === 'Audio') {
                showPill();
                // Moonfin flow (Sean): tapping Play lands you IN the full player; the pill takes
                // over once you back out. Only auto-open on a fresh session start, not track changes.
                if (!host || host.classList.contains('jpx-mp-closed')) {
                    if (!window.__jpxMpSession) { window.__jpxMpSession = true; openJpxMusicPlayer(); }
                }
            } else {
                // A non-audio item started (e.g. a movie/episode). Tear the music UI down so its
                // full-screen now-playing overlay never lingers behind the video player.
                window.__jpxMpSession = false;
                hidePill();
                destroy();
            }
        });
        Events.on(playbackManager, 'playbackstop', () => { window.__jpxMpSession = false; });
        Events.on(playbackManager, 'playbackstop', () => { hidePill(); destroy(); });
    }).catch(() => { /* ignore */ });
    // already playing when we loaded?
    const it = np();
    if (it && it.MediaType === 'Audio') showPill();
}

export default openJpxMusicPlayer;
