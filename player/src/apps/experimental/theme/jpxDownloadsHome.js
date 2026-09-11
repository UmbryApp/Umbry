// Umbry — Downloads library. Lists everything saved for offline (via jpxDownloads), with live
// progress, delete, and offline playback (web: a blob <video>/<audio> overlay; native: the ExoPlayer
// plugin). Self-contained DOM, styled with the app accent tokens (no gradients).
import { getDownloads, onDownloadsChanged, removeDownload, localPlayUrl, isNativeDownloads } from './jpxDownloads';

const ACC = 'var(--jpx-t-accent, #c235ff)';
const ONACC = 'var(--jpx-t-on-accent, #fff)';

function css() {
    if (document.getElementById('jpx-dl-css')) return;
    const s = document.createElement('style');
    s.id = 'jpx-dl-css';
    s.textContent = `
.jpx-dl-wrap { padding: 1.5rem clamp(1rem,3vw,2.5rem) 3rem; color: #fff; }
.jpx-dl-head { font-size: 1.6rem; font-weight: 800; margin: 0 0 .3rem; }
.jpx-dl-sub { color: rgba(255,255,255,.55); font-size: .9rem; margin: 0 0 1.4rem; }
.jpx-dl-empty { color: rgba(255,255,255,.5); font-size: 1rem; padding: 3rem 0; text-align: center; }
.jpx-dl-empty .material-icons { font-size: 54px; opacity: .4; display: block; margin: 0 auto .6rem; }
.jpx-dl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 1.1rem; }
.jpx-dl-card { position: relative; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; overflow: hidden; }
.jpx-dl-poster { position: relative; aspect-ratio: 2/3; background: rgba(255,255,255,.06) center/cover no-repeat; display: flex; align-items: flex-end; }
.jpx-dl-poster.audio { aspect-ratio: 1/1; }
.jpx-dl-noart { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.3); }
.jpx-dl-noart .material-icons { font-size: 40px; }
.jpx-dl-play { position: absolute; inset: 0; border: 0; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 1; transition: opacity .15s; }
.jpx-dl-card:hover .jpx-dl-play { opacity: 1; background: rgba(0,0,0,.35); }
.jpx-dl-play .material-icons { font-size: 46px; color: #fff; filter: drop-shadow(0 1px 5px rgba(0,0,0,.7)); }
.jpx-dl-prog { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(0,0,0,.4); }
.jpx-dl-prog-fill { height: 100%; background: ${ACC}; width: 0; transition: width .2s; }
.jpx-dl-badge { position: absolute; top: 8px; left: 8px; background: ${ACC}; color: ${ONACC}; font-size: .66rem; font-weight: 800; padding: 2px 7px; border-radius: 6px; letter-spacing: .02em; }
.jpx-dl-badge.err { background: #c0392b; }
.jpx-dl-meta { padding: .55rem .65rem .65rem; }
.jpx-dl-name { font-size: .86rem; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.jpx-dl-sub2 { font-size: .74rem; color: rgba(255,255,255,.5); margin-top: .15rem; }
.jpx-dl-del { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 9px; border: 0; background: rgba(0,0,0,.62); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.jpx-dl-card:hover .jpx-dl-del { display: flex; }
.jpx-dl-del:hover { background: #c0392b; }
.jpx-dl-del .material-icons { font-size: 17px; }
.jpx-dl-player { position: fixed; inset: 0; z-index: 5000; background: #000; display: flex; align-items: center; justify-content: center; }
.jpx-dl-player video, .jpx-dl-player audio { max-width: 100%; max-height: 100%; width: 100%; }
.jpx-dl-player.audio { background: #0b0714; }
.jpx-dl-close { position: absolute; top: 16px; right: 18px; z-index: 2; width: 42px; height: 42px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.jpx-dl-close .material-icons { font-size: 24px; }
`;
    document.head.appendChild(s);
}

function fmtSize(n) { if (!n) return ''; const u = ['B','KB','MB','GB']; let i = 0; let v = n; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i]; }

async function play(entry) {
    const url = await localPlayUrl(entry.id);
    if (!url) return;
    const isAudio = entry.mediaType === 'Audio' || entry.type === 'Audio';
    // native app: hand a video off to the ExoPlayer plugin
    const w = window;
    if (!isAudio && w.Capacitor && w.Capacitor.Plugins && w.Capacitor.Plugins.NativeVideo && /^file:/.test(url)) {
        try { w.Capacitor.Plugins.NativeVideo.play({ url, title: entry.name, startPositionMs: 0 }); return; } catch (e) { /* fall through to web */ }
    }
    const ov = document.createElement('div');
    ov.className = 'jpx-dl-player' + (isAudio ? ' audio' : '');
    const media = document.createElement(isAudio ? 'audio' : 'video');
    media.src = url; media.controls = true; media.autoplay = true;
    const close = document.createElement('button');
    close.className = 'jpx-dl-close'; close.innerHTML = '<span class="material-icons">close</span>';
    const shut = () => { try { media.pause(); } catch (e) { /* ignore */ } if (url.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } } ov.remove(); };
    close.addEventListener('click', shut);
    ov.appendChild(media); ov.appendChild(close);
    document.body.appendChild(ov);
}

export function renderDownloadsHome(container) {
    css();
    const root = document.createElement('div');
    root.className = 'jpx-dl-wrap';
    container.innerHTML = '';
    container.appendChild(root);

    const draw = () => {
        const list = getDownloads();
        root.innerHTML = '';
        const h = document.createElement('h1'); h.className = 'jpx-dl-head'; h.textContent = 'Downloads'; root.appendChild(h);
        const sub = document.createElement('p'); sub.className = 'jpx-dl-sub';
        sub.textContent = isNativeDownloads()
            ? 'Saved on this device for offline playback.'
            : (list.length ? 'Saved for offline playback in this app.' : '');
        root.appendChild(sub);
        if (!list.length) {
            const e = document.createElement('div'); e.className = 'jpx-dl-empty';
            e.innerHTML = '<span class="material-icons">download_for_offline</span>Nothing downloaded yet.<br>Open a movie, episode, or track and tap Download to save it for offline.';
            root.appendChild(e); return;
        }
        const grid = document.createElement('div'); grid.className = 'jpx-dl-grid';
        for (const entry of list) {
            const isAudio = entry.mediaType === 'Audio' || entry.type === 'Audio';
            const card = document.createElement('div'); card.className = 'jpx-dl-card';
            const poster = document.createElement('div'); poster.className = 'jpx-dl-poster' + (isAudio ? ' audio' : '');
            if (entry.poster) poster.style.backgroundImage = `url("${entry.poster}")`;
            else { const na = document.createElement('div'); na.className = 'jpx-dl-noart'; na.innerHTML = '<span class="material-icons">' + (isAudio ? 'music_note' : 'movie') + '</span>'; poster.appendChild(na); }
            if (entry.status !== 'done') {
                const b = document.createElement('div'); b.className = 'jpx-dl-badge' + (entry.status === 'error' ? ' err' : '');
                b.textContent = entry.status === 'error' ? 'Failed' : (entry.pct ? entry.pct + '%' : 'Saving…'); poster.appendChild(b);
                const pr = document.createElement('div'); pr.className = 'jpx-dl-prog';
                const pf = document.createElement('div'); pf.className = 'jpx-dl-prog-fill'; pf.style.width = (entry.pct || 0) + '%'; pr.appendChild(pf); poster.appendChild(pr);
            } else {
                const pb = document.createElement('button'); pb.className = 'jpx-dl-play'; pb.title = 'Play offline';
                pb.innerHTML = '<span class="material-icons">play_circle</span>';
                pb.addEventListener('click', () => play(entry)); poster.appendChild(pb);
            }
            const del = document.createElement('button'); del.className = 'jpx-dl-del'; del.title = 'Delete download';
            del.innerHTML = '<span class="material-icons">delete_outline</span>';
            del.addEventListener('click', (ev) => { ev.stopPropagation(); removeDownload(entry.id); });
            poster.appendChild(del);
            card.appendChild(poster);
            const meta = document.createElement('div'); meta.className = 'jpx-dl-meta';
            const nm = document.createElement('div'); nm.className = 'jpx-dl-name'; nm.textContent = entry.seriesName ? (entry.seriesName + ' — ' + entry.name) : entry.name; meta.appendChild(nm);
            const s2 = document.createElement('div'); s2.className = 'jpx-dl-sub2';
            s2.textContent = entry.status === 'error' ? (entry.error || 'Download failed') : [entry.type === 'Episode' ? 'Episode' : (entry.type || ''), entry.status === 'done' ? fmtSize(entry.size) : ''].filter(Boolean).join(' · ');
            if (entry.status === 'error') s2.style.color = '#ff8080';
            meta.appendChild(s2);
            card.appendChild(meta);
            grid.appendChild(card);
        }
        root.appendChild(grid);
    };

    draw();
    const off = onDownloadsChanged(() => draw());
    // detach the listener when the page node is removed
    const mo = new MutationObserver(() => { if (!document.body.contains(container)) { off(); mo.disconnect(); } });
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
}
