// Umbry — Subsonic / Navidrome music home. A self-contained browse + playback experience for the
// active Subsonic server, built as plain DOM into a container (same approach as jpxBooksHome).
// Add a server → browse albums → play. Playback uses a self-contained <audio> now-playing bar
// (the stock playbackManager is Jellyfin-item-shaped; a native audio element is reliable here and
// upgrades to playbackManager integration later).
import { getSubsonicServers, getSubsonicServer, addSubsonicServer, pingSubsonic, getAlbums, getAlbum, coverArtUrl, streamUrl } from 'apps/experimental/theme/jpxSubsonic';

const ACTIVE = 'jpx-active-subsonic';
function activeServer() {
    const list = getSubsonicServers();
    if (!list.length) return null;
    let id = null; try { id = localStorage.getItem(ACTIVE); } catch (e) { /* ignore */ }
    return getSubsonicServer(id) || list[0];
}
function setActive(id) { try { localStorage.setItem(ACTIVE, id); } catch (e) { /* ignore */ } }

function injectStyles() {
    if (document.getElementById('jpx-subsonic-styles')) return;
    const st = document.createElement('style'); st.id = 'jpx-subsonic-styles';
    st.textContent = `
    .jpx-ss { padding: 24px 32px 120px; color: #eee; }
    .jpx-ss-head { display:flex; align-items:center; gap:14px; margin: 6px 0 22px; }
    .jpx-ss-head h1 { font-size: 26px; font-weight: 700; margin:0; }
    .jpx-ss-head .kind { font-size:12px; letter-spacing:1px; text-transform:uppercase; opacity:.6; padding:3px 8px; border:1px solid rgba(255,255,255,.18); border-radius:999px; }
    .jpx-ss-tabs { display:flex; gap:8px; margin-bottom:18px; }
    .jpx-ss-tab { padding:7px 14px; border-radius:999px; background:rgba(255,255,255,.06); cursor:pointer; font-size:13px; border:1px solid transparent; }
    .jpx-ss-tab.active { background:var(--jpx-t-accent, #c235ff); color:var(--jpx-t-on-accent, #fff); font-weight:600; }
    .jpx-ss-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:20px; }
    .jpx-ss-card { cursor:pointer; transition:transform .18s ease; }
    .jpx-ss-card:hover { transform:translateY(-4px); }
    .jpx-ss-cover { width:100%; aspect-ratio:1/1; border-radius:12px; background:#1a1420 center/cover no-repeat; box-shadow:0 10px 24px -10px rgba(0,0,0,.7); overflow:hidden; }
    .jpx-ss-cover img { width:100%; height:100%; object-fit:cover; display:block; border-radius:inherit; }
    .jpx-ss-title { margin-top:8px; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .jpx-ss-sub { font-size:12px; opacity:.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .jpx-ss-setup { display:flex; align-items:center; justify-content:center; min-height:calc(100vh - 5.5rem); padding:1rem 0; box-sizing:border-box; }
    .jpx-ss-form { box-sizing:border-box; max-width:420px; width:100%; margin:0; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); border-radius:18px; padding:28px; backdrop-filter:blur(12px); }
    .jpx-ss-form h2 { margin:0 0 4px; font-size:20px; }
    .jpx-ss-form p { margin:0 0 20px; opacity:.6; font-size:13px; }
    .jpx-ss-form label { display:block; font-size:12px; opacity:.7; margin:14px 0 5px; }
    .jpx-ss-form input { box-sizing:border-box; width:100%; padding:11px 13px; border-radius:10px; border:1px solid rgba(255,255,255,.15); background:rgba(0,0,0,.25); color:#fff; font-size:14px; }
    .jpx-ss-form button { width:100%; margin-top:22px; padding:12px; border:none; border-radius:10px; font-size:15px; font-weight:600; color:var(--jpx-t-on-accent, #fff); cursor:pointer; background:var(--jpx-t-accent, #c235ff); }
    .jpx-ss-form .err { color:#ff8080; font-size:13px; margin-top:12px; min-height:16px; }
    .jpx-ss-songs { position:fixed; inset:0; background:rgba(4,3,10,.86); backdrop-filter:blur(14px); z-index:9000; display:flex; flex-direction:column; padding:40px 8vw; overflow:auto; }
    .jpx-ss-songs .close { position:absolute; top:22px; right:28px; font-size:26px; cursor:pointer; opacity:.7; }
    .jpx-ss-songs .album-head { display:flex; gap:22px; align-items:flex-end; margin-bottom:26px; }
    .jpx-ss-songs .album-head .jpx-ss-cover { width:180px; height:180px; }
    .jpx-ss-songs h2 { margin:0; font-size:30px; }
    .jpx-ss-row { display:flex; align-items:center; gap:14px; padding:11px 12px; border-radius:9px; cursor:pointer; }
    .jpx-ss-row:hover { background:rgba(255,255,255,.06); }
    .jpx-ss-row .num { width:26px; opacity:.5; text-align:right; }
    .jpx-ss-row .nm { flex:1; }
    .jpx-ss-row .dur { opacity:.5; font-variant-numeric:tabular-nums; }
    .jpx-ss-row.playing { color:var(--jpx-t-accent, #c235ff); }
    .jpx-ss-bar { position:fixed; left:0; right:0; bottom:0; height:72px; background:rgba(12,8,18,.94); backdrop-filter:blur(16px); border-top:1px solid rgba(255,255,255,.08); display:flex; align-items:center; gap:16px; padding:0 22px; z-index:9500; transform:translateY(100%); transition:transform .3s ease; }
    .jpx-ss-bar.show { transform:translateY(0); }
    .jpx-ss-bar .art { width:48px; height:48px; border-radius:8px; background:#241a2c center/cover no-repeat; }
    .jpx-ss-bar .meta { min-width:160px; }
    .jpx-ss-bar .meta .t { font-weight:600; font-size:14px; }
    .jpx-ss-bar .meta .a { font-size:12px; opacity:.6; }
    .jpx-ss-bar .ctrl { display:flex; align-items:center; gap:18px; }
    .jpx-ss-bar .ctrl button { background:none; border:none; color:#eee; font-size:22px; cursor:pointer; }
    .jpx-ss-bar .ctrl .pp { font-size:30px; }
    .jpx-ss-bar .seek { flex:1; display:flex; align-items:center; gap:10px; font-size:11px; opacity:.7; font-variant-numeric:tabular-nums; }
    .jpx-ss-bar .seek input { flex:1; }
    `;
    document.head.appendChild(st);
}

const fmt = secs => { secs = Math.floor(secs || 0); const m = Math.floor(secs / 60), s = secs % 60; return m + ':' + (s < 10 ? '0' : '') + s; };

// ---- self-contained now-playing bar ----
let audio = null, queue = [], qIndex = -1, srvRef = null, barEl = null;
function ensureBar() {
    if (barEl) return barEl;
    injectStyles();
    audio = new Audio(); audio.preload = 'auto'; window.__jpxSubAudio = audio;
    barEl = document.createElement('div'); barEl.className = 'jpx-ss-bar';
    barEl.innerHTML = `
      <div class="art"></div>
      <div class="meta"><div class="t">—</div><div class="a"></div></div>
      <div class="ctrl"><button class="prev">⏮</button><button class="pp">▶</button><button class="next">⏭</button></div>
      <div class="seek"><span class="cur">0:00</span><input type="range" min="0" max="1000" value="0"><span class="tot">0:00</span></div>`;
    document.body.appendChild(barEl);
    const $ = s => barEl.querySelector(s);
    $('.pp').onclick = () => { if (audio.paused) audio.play(); else audio.pause(); };
    $('.prev').onclick = () => playIndex(qIndex - 1);
    $('.next').onclick = () => playIndex(qIndex + 1);
    audio.addEventListener('play', () => { $('.pp').textContent = '⏸'; });
    audio.addEventListener('pause', () => { $('.pp').textContent = '▶'; });
    audio.addEventListener('ended', () => playIndex(qIndex + 1));
    audio.addEventListener('timeupdate', () => {
        $('.cur').textContent = fmt(audio.currentTime);
        if (audio.duration) { $('.tot').textContent = fmt(audio.duration); $('.seek input').value = String(Math.round(audio.currentTime / audio.duration * 1000)); }
    });
    $('.seek input').addEventListener('input', e => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
    return barEl;
}
function playIndex(i) {
    if (!queue.length) return;
    qIndex = (i + queue.length) % queue.length;
    const song = queue[qIndex];
    ensureBar();
    audio.src = streamUrl(srvRef, song.__subStreamId);
    audio.play().catch(() => {});
    const $ = s => barEl.querySelector(s);
    $('.meta .t').textContent = song.Name;
    $('.meta .a').textContent = (song.Artists || []).join(', ');
    $('.art').style.backgroundImage = song.__subCover ? `url("${coverArtUrl(srvRef, song.__subCover, 96)}")` : 'none';
    barEl.classList.add('show');
    window.__jpxSubQIndex = qIndex; // for verification
    document.querySelectorAll('.jpx-ss-row').forEach((r, idx) => r.classList.toggle('playing', idx === qIndex));
}
export function jpxSubsonicPlayQueue(srv, songs, startIndex) { srvRef = srv; queue = songs || []; playIndex(startIndex || 0); }

// ---- browse ----
async function showAlbum(container, srv, album) {
    const overlay = document.createElement('div'); overlay.className = 'jpx-ss-songs';
    overlay.innerHTML = '<div class="close">✕</div><div class="album-head"><div class="jpx-ss-cover"></div><div><div class="jpx-ss-sub">Album</div><h2></h2><div class="jpx-ss-sub art"></div></div></div><div class="list">Loading…</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.close').onclick = () => overlay.remove();
    overlay.querySelector('h2').textContent = album.Name;
    overlay.querySelector('.album-head .art').textContent = album.AlbumArtist || '';
    if (album.__subCover) overlay.querySelector('.jpx-ss-cover').style.backgroundImage = `url("${coverArtUrl(srv, album.__subCover, 400)}")`;
    try {
        const { songs } = await getAlbum(srv, album.Id);
        const list = overlay.querySelector('.list'); list.innerHTML = '';
        songs.forEach((s, i) => {
            const row = document.createElement('div'); row.className = 'jpx-ss-row';
            row.innerHTML = `<div class="num">${s.IndexNumber || i + 1}</div><div class="nm">${s.Name}</div><div class="dur">${fmt((s.RunTimeTicks || 0) / 10000000)}</div>`;
            row.onclick = () => jpxSubsonicPlayQueue(srv, songs, i);
            list.appendChild(row);
        });
    } catch (e) { overlay.querySelector('.list').textContent = 'Failed to load album: ' + e.message; }
}

async function renderBrowse(container, srv) {
    srvRef = srv;
    container.innerHTML = `
      <div class="jpx-ss">
        <div class="jpx-ss-head"><h1>${srv.name}</h1><span class="kind">${(srv.kind || 'subsonic')}</span></div>
        <div class="jpx-ss-tabs">
          <div class="jpx-ss-tab active" data-t="newest">Recently Added</div>
          <div class="jpx-ss-tab" data-t="frequent">Most Played</div>
          <div class="jpx-ss-tab" data-t="random">Random</div>
          <div class="jpx-ss-tab" data-t="alphabeticalByName">A–Z</div>
        </div>
        <div class="jpx-ss-grid">Loading…</div>
      </div>`;
    const grid = container.querySelector('.jpx-ss-grid');
    async function load(type) {
        grid.innerHTML = 'Loading…';
        try {
            const albums = await getAlbums(srv, type, 60);
            grid.innerHTML = '';
            albums.forEach(al => {
                const card = document.createElement('div'); card.className = 'jpx-ss-card';
                const cover = al.__subCover ? `<img loading="lazy" src="${coverArtUrl(srv, al.__subCover, 300)}" alt="">` : '';
                card.innerHTML = `<div class="jpx-ss-cover">${cover}</div><div class="jpx-ss-title">${al.Name}</div><div class="jpx-ss-sub">${al.AlbumArtist || ''}</div>`;
                card.onclick = () => showAlbum(container, srv, al);
                grid.appendChild(card);
            });
            window.__jpxSubAlbums = albums.length; // for verification
        } catch (e) { grid.innerHTML = 'Failed to load: ' + e.message; }
    }
    container.querySelectorAll('.jpx-ss-tab').forEach(t => t.onclick = () => {
        container.querySelectorAll('.jpx-ss-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); load(t.getAttribute('data-t'));
    });
    load('newest');
}

function renderAddForm(container, onDone) {
    container.innerHTML = `
      <div class="jpx-ss jpx-ss-setup">
        <form class="jpx-ss-form">
          <h2>Connect a music server</h2>
          <p>Umbry works with Navidrome, Airsonic and any Subsonic-API server.</p>
          <label>Server address</label><input name="base" placeholder="https://music.example.com" autocomplete="off">
          <label>Username</label><input name="user" autocomplete="off">
          <label>Password</label><input name="pass" type="password" autocomplete="off">
          <button type="submit">Connect</button>
          <div class="err"></div>
        </form>
      </div>`;
    const form = container.querySelector('form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const base = form.base.value.trim().replace(/\/+$/, ''), user = form.user.value.trim(), pass = form.pass.value;
        const err = form.querySelector('.err'); err.textContent = 'Connecting…';
        if (!base || !user) { err.textContent = 'Server address and username are required.'; return; }
        const res = await pingSubsonic(base, user, pass);
        if (!res.ok) { err.textContent = res.error || 'Could not connect.'; return; }
        const id = 's' + Math.random().toString(36).slice(2, 10);
        addSubsonicServer({ id, name: (res.kind === 'navidrome' ? 'Navidrome' : 'Subsonic'), base, user, password: pass, kind: res.kind });
        setActive(id);
        onDone();
    };
}

export function renderSubsonicHome(container) {
    if (!container) return;
    injectStyles(); ensureBar();
    const srv = activeServer();
    if (!srv) renderAddForm(container, () => renderSubsonicHome(container));
    else renderBrowse(container, srv);
}
export default renderSubsonicHome;
