// Umbry — Moonfin-style video player OSD.
//
// Reskins the stock video OSD rather than rebuilding it: the battle-tested controller keeps
// owning playback state, the slider, and show/hide timing. This module (1) adds a top-left
// back + item-logo bar, (2) REPARENTS the stock transport buttons (rewind/pause/forward —
// listeners survive reparenting) into a centered overlay with Moonfin's ⏮ ⟲10 ⏸ ⟳30 icons,
// (3) replaces the bottom button row with Moonfin's icon bar, and (4) provides the eight
// frosted sheets (speed / chapters / subtitles / audio / bitrate / cast&crew / remote / info).
// Every action delegates to playbackManager or a stock button, so behavior is unchanged.

import { playbackManager } from 'components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events';
import './jpxVideoOsd.scss';

// Umbry — apply the user's Player Buttons preference (jpx-pref-osdButtons {order,hidden}, set from
// Settings > Video Playback > Player Buttons) to the options-sheet buttons. Runs each time the menu
// opens so it always reflects the latest choice. Keys = each button's `title`.
function applyOsdButtonPrefs(moreList) {
    let pref = null;
    try { pref = JSON.parse(localStorage.getItem('jpx-pref-osdButtons') || 'null'); } catch (e) { pref = null; }
    const items = Array.from(moreList.children);
    items.forEach(b => { b.style.display = ''; }); // reset before applying
    if (!pref) return;
    const byTitle = {};
    items.forEach(b => { if (b.title) byTitle[b.title] = b; });
    (pref.hidden || []).forEach(t => { if (byTitle[t]) byTitle[t].style.display = 'none'; });
    const seq = (pref.order || []).slice();
    items.forEach(b => { if (b.title && seq.indexOf(b.title) === -1) seq.push(b.title); });
    seq.forEach(t => { if (byTitle[t]) moreList.appendChild(byTitle[t]); });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}

export function initJpxVideoOsd(view, getPlayer) {
    if (view.__jpxOsd) return;
    view.__jpxOsd = true;
    try {
        const osdBottom = view.querySelector('.videoOsdBottom');
        const osdControls = view.querySelector('.osdControls');
        if (!osdBottom || !osdControls) return;
        view.classList.add('jpx-osd');

        // ---- top bar: back + item logo (falls back to the stock title text) ----
        const top = el('div', 'jpx-osd-top',
            '<button type="button" class="jpx-osd-back"><span class="material-icons" aria-hidden="true">arrow_back</span></button>'
            + '<img class="jpx-osd-logo hide" alt="" /><div class="jpx-osd-title"></div>');
        view.appendChild(top);
        top.querySelector('.jpx-osd-back').addEventListener('click', () => { try { history.back(); } catch (e) { /* ignore */ } });

        // ---- center transport: reparent stock buttons (their listeners come along) ----
        const center = el('div', 'jpx-osd-center');
        view.appendChild(center);
        const btnRewind = view.querySelector('.btnRewind');
        const btnPause = view.querySelector('.btnPause');
        const btnFf = view.querySelector('.btnFastForward');
        const prevBtn = el('button', 'jpx-osd-prev paper-icon-button-light',
            '<span class="xlargePaperIconButton material-icons" aria-hidden="true">skip_previous</span>');
        prevBtn.type = 'button';
        prevBtn.addEventListener('click', () => {
            const stock = view.querySelector('.btnPreviousTrack');
            if (stock && !stock.classList.contains('hide')) stock.click();
            else { try { playbackManager.seekMs(0, getPlayer()); } catch (e) { /* ignore */ } }
        });
        center.appendChild(prevBtn);
        if (btnRewind) { center.appendChild(btnRewind); const ic = btnRewind.querySelector('.material-icons'); if (ic) { ic.classList.remove('fast_rewind'); ic.textContent = 'replay_10'; } }
        if (btnPause) center.appendChild(btnPause);
        if (btnFf) { center.appendChild(btnFf); const ic = btnFf.querySelector('.material-icons'); if (ic) { ic.classList.remove('fast_forward'); ic.textContent = 'forward_30'; } }
        // clicking a transport button must NOT also trigger the video's tap-to-toggle (that double
        // toggle is why a single Pause click did nothing — it paused then instantly un-paused).
        // the view's tap-to-toggle is bound on POINTERDOWN (not click) and only skips targets inside
        // .videoOsdBottom; our transport lives in .jpx-osd-center at the view root, so pointerdown
        // reached it and toggled play a second time (pause-on-down, un-pause-on-click = dead button).
        ['pointerdown', 'click'].forEach((ev) => center.addEventListener(ev, (e) => e.stopPropagation()));

        // ---- Progress Bar Time: configurable labels above/below the scrubber (jpx-pref-pbt_*) ----
        (function setupPbt() {
            const sliderRow = osdControls.querySelector('.flex.flex-direction-row');
            if (!sliderRow || !sliderRow.parentNode) return;
            // hide the stock time texts; our own labels replace them
            ['.osdTimeText', '.osdPositionText', '.osdDurationText'].forEach(sel => {
                const e2 = view.querySelector(sel); if (e2) e2.style.display = 'none';
            });
            const mkRow = (cls) => el('div', 'jpx-osd-pbt ' + cls,
                '<span class="jpx-osd-pbt-l"></span><span class="jpx-osd-pbt-c"></span><span class="jpx-osd-pbt-r"></span>');
            const above = mkRow('jpx-osd-pbt-above');
            const below = mkRow('jpx-osd-pbt-below');
            sliderRow.parentNode.insertBefore(above, sliderRow);
            if (sliderRow.nextSibling) sliderRow.parentNode.insertBefore(below, sliderRow.nextSibling);
            else sliderRow.parentNode.appendChild(below);
            const pref = (k, d) => { try { const v = localStorage.getItem('jpx-pref-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
            const fmt = (sec) => { if (!isFinite(sec) || sec < 0) sec = 0; sec = Math.floor(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'); };
            const valFor = (mode, posSec, durSec) => {
                switch (mode) {
                    case 'elapsed': return fmt(posSec);
                    case 'remaining': return durSec > 0 ? '-' + fmt(durSec - posSec) : '';
                    case 'duration': return durSec > 0 ? fmt(durSec) : '';
                    case 'endsat': {
                        if (durSec <= 0) return '';
                        const end = new Date(Date.now() + Math.max(0, durSec - posSec) * 1000);
                        return 'Ends at ' + end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    }
                    default: return '';
                }
            };
            const slots = [
                [above.querySelector('.jpx-osd-pbt-l'), 'pbt_above_left', 'none'],
                [above.querySelector('.jpx-osd-pbt-c'), 'pbt_above_center', 'none'],
                [above.querySelector('.jpx-osd-pbt-r'), 'pbt_above_right', 'endsat'],
                [below.querySelector('.jpx-osd-pbt-l'), 'pbt_below_left', 'elapsed'],
                [below.querySelector('.jpx-osd-pbt-c'), 'pbt_below_center', 'none'],
                [below.querySelector('.jpx-osd-pbt-r'), 'pbt_below_right', 'duration']
            ];
            let iv = 0;
            const tick = () => {
                if (!document.body.contains(view)) { clearInterval(iv); return; }
                let posSec = 0, durSec = 0;
                try { posSec = (playbackManager.currentTime(getPlayer()) || 0) / 1000; } catch (e) { /* ignore */ }
                try { const it = playbackManager.currentItem(getPlayer()); const t = it && it.RunTimeTicks; if (t) durSec = t / 10000000; } catch (e) { /* ignore */ }
                slots.forEach(row => { if (row[0]) row[0].textContent = valFor(pref(row[1], row[2]), posSec, durSec); });
            };
            iv = setInterval(tick, 500);
            tick();
        })();

        // ---- bottom bar: volume on the left, a single "More" dropdown on the right ----
        const bar = el('div', 'jpx-osd-bar');
        osdControls.appendChild(bar);
        bar.addEventListener('click', (e) => e.stopPropagation());
        const player = () => getPlayer();
        const item = () => { try { return playbackManager.currentItem(player()); } catch (e) { return null; } };
        const mediaSource = () => { try { return playbackManager.currentMediaSource(player()); } catch (e) { return null; } };

        // volume + mute (left)
        const volWrap = el('div', 'jpx-osd-vol',
            '<button type="button" class="jpx-osd-btn jpx-osd-vol-btn"><span class="material-icons" aria-hidden="true">volume_up</span></button>'
            + '<input type="range" class="jpx-osd-vol-slider" min="0" max="100" step="1" value="100" />');
        bar.appendChild(volWrap);
        const volBtn = volWrap.querySelector('.jpx-osd-vol-btn');
        const volIcon = volBtn.querySelector('.material-icons');
        const volSlider = volWrap.querySelector('.jpx-osd-vol-slider');
        const volIconFor = (v, muted) => (muted || v <= 0) ? 'volume_off' : (v < 45 ? 'volume_down' : 'volume_up');
        const syncVol = () => {
            try {
                const muted = playbackManager.isMuted(player());
                const v = Math.round(playbackManager.getVolume(player()) || 0);
                if (document.activeElement !== volSlider) volSlider.value = muted ? 0 : v;
                volSlider.style.setProperty('--v', (muted ? 0 : v) + '%');
                volIcon.textContent = volIconFor(v, muted);
            } catch (e) { /* ignore */ }
        };
        volSlider.addEventListener('input', () => {
            const v = parseInt(volSlider.value, 10) || 0;
            try { if (playbackManager.isMuted(player()) && v > 0) playbackManager.setMute(false, player()); playbackManager.setVolume(v, player()); } catch (e) { /* ignore */ }
            volSlider.style.setProperty('--v', v + '%');
            volIcon.textContent = volIconFor(v, false);
        });
        volBtn.addEventListener('click', () => { try { playbackManager.toggleMute(player()); } catch (e) { /* ignore */ } setTimeout(syncVol, 40); });

        // "More" dropdown (right) — every extra option lives here instead of one long messy row
        const moreWrap = el('div', 'jpx-osd-more');
        const moreBtn = el('button', 'jpx-osd-btn jpx-osd-more-btn', '<span class="material-icons" aria-hidden="true">tune</span>');
        moreBtn.type = 'button'; moreBtn.title = 'More options';
        const moreDrop = el('div', 'jpx-osd-more-drop');
        const moreList = el('div', 'jpx-osd-more-list');
        moreDrop.appendChild(moreList);
        moreWrap.appendChild(moreBtn); moreWrap.appendChild(moreDrop);
        bar.appendChild(moreWrap);
        const closeMore = () => moreWrap.classList.remove('open');
        moreBtn.addEventListener('click', (e) => { e.stopPropagation(); try { applyOsdButtonPrefs(moreList); } catch (err) { /* ignore */ } moreWrap.classList.toggle('open'); });
        document.addEventListener('click', (e) => { if (!moreWrap.contains(e.target)) closeMore(); });

        const mkBtn = (icon, title, onClick, cls) => {
            const b = el('button', 'jpx-osd-menu-item' + (cls ? ' ' + cls : ''),
                '<span class="material-icons" aria-hidden="true">' + icon + '</span><span class="jpx-osd-menu-lb">' + esc(title) + '</span>');
            b.type = 'button';
            b.title = title;
            b.addEventListener('click', (e) => { onClick(e); closeMore(); });
            moreList.appendChild(b);
            return b;
        };

        // ---------- shared frosted sheet ----------
        const sheet = (title, bodyHtml) => {
            const host = el('div', 'jpx-osd-overlay',
                '<div class="jpx-osd-card"><div class="jpx-osd-card-title">' + esc(title) + '</div>'
                + '<div class="jpx-osd-card-body">' + bodyHtml + '</div></div>');
            document.body.appendChild(host);
            const close = () => { try { host.remove(); } catch (e) { /* ignore */ } };
            host.addEventListener('click', (e) => { if (e.target === host) close(); });
            host.querySelectorAll('.jpx-osd-cancel').forEach(b => b.addEventListener('click', close));
            return { host, close };
        };
        const radioRow = (main, sub, selected, extra) =>
            '<button type="button" class="jpx-osd-row' + (selected ? ' selected' : '') + '"' + (extra || '') + '>'
            + '<span class="jpx-osd-check material-icons" aria-hidden="true">' + (selected ? 'check_circle' : 'radio_button_unchecked') + '</span>'
            + '<span class="jpx-osd-row-body"><span class="jpx-osd-row-main">' + main + '</span>'
            + (sub ? '<span class="jpx-osd-row-sub">' + sub + '</span>' : '') + '</span></button>';
        const cancelRow = (label) =>
            '<button type="button" class="jpx-osd-row jpx-osd-cancel"><span class="jpx-osd-check material-icons" aria-hidden="true">radio_button_unchecked</span>'
            + '<span class="jpx-osd-row-body"><span class="jpx-osd-row-main">' + (label || 'Cancel') + '</span></span></button>';

        // ---------- Favorite ----------
        const favBtn = mkBtn('favorite_border', 'Favorite', () => {
            const it = item();
            if (!it || !it.ServerId) return;
            const ac = ServerConnections.getApiClient(it.ServerId);
            const cur = !!(it.UserData && it.UserData.IsFavorite);
            Promise.resolve(ac.updateFavoriteStatus(ac.getCurrentUserId(), it.Id, !cur)).then(() => {
                it.UserData = it.UserData || {};
                it.UserData.IsFavorite = !cur;
                favBtn.querySelector('.material-icons').textContent = !cur ? 'favorite' : 'favorite_border';
                favBtn.classList.toggle('jpx-osd-btn-on', !cur);
            }).catch(() => { /* ignore */ });
        });

        // ---------- Playback speed ----------
        const speedBtn = el('button', 'jpx-osd-menu-item jpx-osd-speed',
            '<span class="material-icons" aria-hidden="true">slow_motion_video</span><span class="jpx-osd-menu-lb">Playback speed</span><span class="jpx-osd-speed-lb">1.0x</span>');
        speedBtn.type = 'button';
        speedBtn.title = 'Playback speed';
        moreList.appendChild(speedBtn);
        speedBtn.addEventListener('click', closeMore);
        const speedLabel = speedBtn.querySelector('.jpx-osd-speed-lb');
        speedBtn.addEventListener('click', () => {
            let cur = 1;
            try { cur = playbackManager.getPlaybackRate(player()) || 1; } catch (e) { /* ignore */ }
            const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
            const s = sheet('Playback speed', rates.map(r =>
                radioRow(r.toFixed(r === 0.75 ? 2 : 1) + 'x', '', Math.abs(r - cur) < 0.01, ' data-v="' + r + '"')).join('') + cancelRow());
            s.host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
                const r = parseFloat(b.getAttribute('data-v'));
                try { playbackManager.setPlaybackRate(r, player()); } catch (e) { /* ignore */ }
                speedLabel.textContent = (r === 0.75 ? '0.75' : r.toFixed(1)) + 'x';
                s.close();
            }));
        });

        // ---------- Chapters ----------
        mkBtn('bookmark_border', 'Chapters', () => {
            const it = item();
            const chapters = (it && it.Chapters) || [];
            if (!chapters.length) { sheet('Chapters', '<div class="jpx-osd-empty">No chapters.</div>' + cancelRow('Close')); return; }
            let posTicks = 0;
            try { posTicks = (playbackManager.currentTime(player()) || 0) * 10000; } catch (e) { /* ignore */ }
            const rows = chapters.map((c, i) => {
                const secs = Math.round((c.StartPositionTicks || 0) / 10000000);
                const t = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
                const next = chapters[i + 1];
                const cur = posTicks >= (c.StartPositionTicks || 0) && (!next || posTicks < next.StartPositionTicks);
                return radioRow(esc(c.Name || ('Chapter ' + (i + 1))), t, cur, ' data-t="' + (c.StartPositionTicks || 0) + '"');
            }).join('');
            const s = sheet('Chapters', rows + cancelRow());
            s.host.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
                try { playbackManager.seek(parseInt(b.getAttribute('data-t'), 10), player()); } catch (e) { /* ignore */ }
                s.close();
            }));
        });

        // ---------- Subtitles ----------
        mkBtn('subtitles', 'Subtitle Track', () => {
            let tracks = [], cur = -1;
            try { tracks = playbackManager.subtitleTracks(player()) || []; cur = playbackManager.getSubtitleStreamIndex(player()); } catch (e) { /* ignore */ }
            const rows = [radioRow('Off', '', cur == null || cur === -1, ' data-i="-1"')].concat(tracks.map((t, n) => {
                const lang = t.DisplayLanguage || t.Language || t.Title || 'Unknown';
                const codec = (t.Codec || '').toUpperCase();
                return radioRow((n + 1) + ' - ' + esc(lang) + (codec ? ' (' + codec + ')' : ''),
                    [codec, t.IsExternal ? 'External' : 'Embedded'].filter(Boolean).join(' · '),
                    cur === t.Index, ' data-i="' + t.Index + '"');
            })).join('');
            const s = sheet('Subtitle Track', rows + cancelRow());
            s.host.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
                try { playbackManager.setSubtitleStreamIndex(parseInt(b.getAttribute('data-i'), 10), player()); } catch (e) { /* ignore */ }
                s.close();
            }));
        });

        // ---------- Audio ----------
        mkBtn('music_note', 'Audio Track', () => {
            let tracks = [], cur = -1;
            try { tracks = playbackManager.audioTracks(player()) || []; cur = playbackManager.getAudioStreamIndex(player()); } catch (e) { /* ignore */ }
            const rows = tracks.map((t, n) => {
                const codec = (t.Codec || '').toUpperCase();
                const ch = t.Channels ? t.Channels + 'ch' : '';
                return radioRow((n + 1) + ' - ' + esc(t.DisplayTitle || t.Language || 'Track ' + (n + 1)),
                    [t.Language, codec, ch].filter(Boolean).join(' · '), cur === t.Index, ' data-i="' + t.Index + '"');
            }).join('');
            const s = sheet('Audio Track', rows + cancelRow());
            s.host.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
                try { playbackManager.setAudioStreamIndex(parseInt(b.getAttribute('data-i'), 10), player()); } catch (e) { /* ignore */ }
                s.close();
            }));
        });

        // ---------- Cast & Crew ----------
        mkBtn('people_alt', 'Cast & Crew', () => {
            const it = item();
            const people = (it && it.People) || [];
            if (!people.length) { sheet('Cast & Crew', '<div class="jpx-osd-empty">No cast information.</div>' + cancelRow('Close')); return; }
            const ac = it.ServerId ? ServerConnections.getApiClient(it.ServerId) : null;
            const cards = people.slice(0, 24).map(p => {
                const img = (p.PrimaryImageTag && ac)
                    ? ac.getScaledImageUrl(p.Id, { type: 'Primary', maxHeight: 220, tag: p.PrimaryImageTag }) : null;
                return '<a class="jpx-osd-person" href="#/details?id=' + p.Id + '">'
                    + '<span class="jpx-osd-person-img"' + (img ? ' style="background-image:url(\'' + img + '\')"' : '')
                    + '>' + (img ? '' : '<span class="material-icons" aria-hidden="true">person</span>') + '</span>'
                    + '<span class="jpx-osd-person-name">' + esc(p.Name) + '</span>'
                    + (p.Role ? '<span class="jpx-osd-person-role">' + esc(p.Role) + '</span>' : '') + '</a>';
            }).join('');
            sheet('Cast & Crew', '<div class="jpx-osd-people">' + cards + '</div>');
        });

        // ---------- Remote Playback ----------
        mkBtn('cast', 'Remote Playback', () => {
            const s = sheet('Remote Playback', '<div class="jpx-osd-empty">Looking for devices…</div>');
            Promise.resolve(playbackManager.getTargets()).then(targets => {
                const body = s.host.querySelector('.jpx-osd-card-body');
                if (!body) return;
                if (!targets || !targets.length) { body.innerHTML = '<div class="jpx-osd-empty">No playback devices found.</div>' + cancelRow('Close'); }
                else {
                    body.innerHTML = targets.map((t, i) => radioRow(esc(t.name || t.deviceName || 'Device'),
                        esc([t.deviceType, t.appName].filter(Boolean).join(' · ')), !!t.isLocalPlayer, ' data-n="' + i + '"')).join('') + cancelRow();
                    body.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
                        const t = targets[parseInt(b.getAttribute('data-n'), 10)];
                        try { playbackManager.trySetActivePlayer(t.playerName, t); } catch (e) { /* ignore */ }
                        s.close();
                    }));
                }
                s.host.querySelectorAll('.jpx-osd-cancel').forEach(b => b.addEventListener('click', s.close));
            }).catch(() => { /* leave the looking message */ });
        });

        // ---------- Bitrate ----------
        mkBtn('video_settings', 'Bitrate', () => {
            const KEY = 'jpx-osd-bitrate';
            let cur = 'auto';
            try { cur = localStorage.getItem(KEY) || 'auto'; } catch (e) { /* ignore */ }
            const opts = [
                { v: 'auto', label: 'Auto' },
                { v: '40000000', label: '40 Mbps' },
                { v: '20000000', label: '20 Mbps' },
                { v: '10000000', label: '10 Mbps' },
                { v: '4000000', label: '4 Mbps' }
            ];
            const s = sheet('Bitrate', opts.map(o => radioRow(o.label, '', cur === o.v, ' data-v="' + o.v + '"')).join('') + cancelRow());
            s.host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
                const v = b.getAttribute('data-v');
                try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ }
                try {
                    playbackManager.setMaxStreamingBitrate({
                        enableAutomaticBitrateDetection: v === 'auto',
                        maxBitrate: v === 'auto' ? null : parseInt(v, 10)
                    }, player());
                } catch (e) { /* ignore */ }
                s.close();
            }));
        });

        // ---------- Aspect ratio (list picker showing the current one) ----------
        mkBtn('crop', 'Aspect ratio', () => {
            const p = player();
            const sup = playbackManager.getSupportedAspectRatios(p) || [];
            if (!sup.length) return;
            const cur = playbackManager.getAspectRatio(p);
            const s = sheet('Aspect ratio', sup.map(a => radioRow(a.name, '', a.id === cur, ' data-ar="' + a.id + '"')).join('') + cancelRow());
            s.host.querySelectorAll('[data-ar]').forEach(b => b.addEventListener('click', () => {
                try { playbackManager.setAspectRatio(b.getAttribute('data-ar'), p); } catch (e) { /* ignore */ }
                s.close();
            }));
        });

        // ---------- Rotation lock (phones) / Fullscreen (desktops) ----------
        if (screen.orientation && screen.orientation.lock && 'ontouchstart' in window) {
            let locked = false;
            const rotBtn = mkBtn('screen_rotation', 'Rotation lock', () => {
                if (locked) { try { screen.orientation.unlock(); } catch (e) { /* ignore */ } locked = false; }
                else {
                    Promise.resolve(screen.orientation.lock(String(screen.orientation.type || '').startsWith('landscape') ? 'landscape' : 'portrait'))
                        .then(() => { locked = true; rotBtn.classList.add('jpx-osd-btn-on'); })
                        .catch(() => { /* ignore */ });
                    return;
                }
                rotBtn.classList.toggle('jpx-osd-btn-on', locked);
            });
        } else {
            mkBtn('fullscreen', 'Fullscreen', () => { const b = view.querySelector('.btnFullscreen'); if (b) b.click(); });
        }

        // ---------- Playback Information ----------
        mkBtn('info_outline', 'Playback Information', () => {
            const it = item() || {};
            const ms = mediaSource() || {};
            let state = {};
            try { state = playbackManager.getPlayerState(player()) || {}; } catch (e) { /* ignore */ }
            const v = (ms.MediaStreams || []).find(x => x.Type === 'Video');
            const fps = v && (v.RealFrameRate || v.AverageFrameRate);
            const kv = (k, val) => val ? '<div class="jpx-osd-kv"><span>' + k + '</span><b>' + esc(val) + '</b></div>' : '';
            sheet('Playback Information',
                '<div class="jpx-osd-kv-group">Playback</div>'
                + kv('File Name', ms.Path ? ms.Path.split(/[\\/]/).pop() : (it.Name || ''))
                + kv('Play Method', (state.PlayState && state.PlayState.PlayMethod) === 'DirectPlay' ? 'Direct Play' : (state.PlayState && state.PlayState.PlayMethod))
                + kv('Player', 'Umbry Web Player')
                + kv('Container', ms.Container ? ms.Container.toUpperCase() : '')
                + kv('Bitrate', ms.Bitrate ? (ms.Bitrate / 1000000).toFixed(1) + ' Mbps' : '')
                + (v ? '<div class="jpx-osd-kv-group">Video</div>'
                    + kv('Resolution', v.Width && v.Height ? v.Width + '×' + v.Height + (fps ? ' @ ' + Math.round(fps) + 'fps' : '') : '')
                    + kv('Codec', v.Codec ? v.Codec.toUpperCase() : '')
                    + kv('Range', v.VideoRange) : '')
                + cancelRow('Close'));
        });

        // ---- keep logo / favorite / speed in sync with what's playing ----
        const refresh = () => {
            const it = item();
            const logo = top.querySelector('.jpx-osd-logo');
            const titleEl = top.querySelector('.jpx-osd-title');
            if (!it) return;
            let url = null;
            try {
                const ac = it.ServerId ? ServerConnections.getApiClient(it.ServerId) : null;
                if (ac && it.ImageTags && it.ImageTags.Logo) url = ac.getScaledImageUrl(it.Id, { type: 'Logo', maxWidth: 400, tag: it.ImageTags.Logo });
                else if (ac && it.ParentLogoItemId && it.ParentLogoImageTag) url = ac.getScaledImageUrl(it.ParentLogoItemId, { type: 'Logo', maxWidth: 400, tag: it.ParentLogoImageTag });
            } catch (e) { /* ignore */ }
            if (url) { logo.src = url; logo.classList.remove('hide'); titleEl.textContent = ''; }
            else { logo.classList.add('hide'); titleEl.textContent = it.Name || ''; }
            const fav = !!(it.UserData && it.UserData.IsFavorite);
            favBtn.querySelector('.material-icons').textContent = fav ? 'favorite' : 'favorite_border';
            favBtn.classList.toggle('jpx-osd-btn-on', fav);
            let rate = 1;
            try { rate = playbackManager.getPlaybackRate(player()) || 1; } catch (e) { /* ignore */ }
            speedLabel.textContent = (rate === 0.75 ? '0.75' : Number(rate).toFixed(1)) + 'x';
        };
        Events.on(playbackManager, 'playbackstart', refresh);
        Events.on(playbackManager, 'volumechange', syncVol);
        setTimeout(() => { refresh(); syncVol(); }, 600);

        // ---- our fixed layers hide/show with the stock OSD ----
        const sync = () => {
            const hidden = osdBottom.classList.contains('hide') || osdBottom.classList.contains('videoOsdBottom-hidden');
            top.classList.toggle('jpx-osd-hidden', hidden);
            center.classList.toggle('jpx-osd-hidden', hidden);
        };
        new MutationObserver(sync).observe(osdBottom, { attributes: true, attributeFilter: ['class'] });
        sync();
    } catch (e) {
        console.error('[jpxVideoOsd] init failed', e);
    }
}

export default initJpxVideoOsd;
