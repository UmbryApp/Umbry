/* eslint-disable @typescript-eslint/no-explicit-any */
// Umbry native Live TV — server-agnostic FAST channels on EVERY server, independent of any
// media server. Channels + streams come from umbry-fast, a self-contained local proxy (Pluto/Tubi/
// Plex/Samsung reimplemented in Node) plus public M3U lists; EPG (now/next) from Pluto's inline timelines + Plex's XMLTV, recomputed live on
// a timer. Played via the bundled hls.js. The channel list is windowed (only visible rows render)
// so 2500+ channels stay smooth. No external service dependencies — channels are fetched directly.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './jpxLiveTv.scss';

// FAST-channel proxy base — self-contained. Defaults to umbry-fast on THIS host (the Electron
// Player runs it on 127.0.0.1:7880; the Docker stack runs it as a sidecar). Points at no one's
// infra. Override with localStorage 'umbry-fast-base' or window.__UMBRY_FAST_BASE (in-house only).
const FAST_BASE = ((): string => {
    try { const o = localStorage.getItem('umbry-fast-base'); if (o) return o.replace(/\/$/, ''); } catch { /* ignore */ }
    const w = window as unknown as { __UMBRY_FAST_BASE?: string };
    if (w.__UMBRY_FAST_BASE) return String(w.__UMBRY_FAST_BASE).replace(/\/$/, '');
    return `${window.location.protocol}//${window.location.hostname}:7880`;
})();
const W = {
    pluto: `${FAST_BASE}/pluto`,
    samsung: `${FAST_BASE}/samsung`,
    tubi: FAST_BASE,
    plex: FAST_BASE,
    hls: `${FAST_BASE}/hls?url=`
};
const ROKU_M3U = 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u';
const XUMO_M3U = 'https://raw.githubusercontent.com/BuddyChewChew/xumo-playlist-generator/refs/heads/main/playlists/xumo_playlist.m3u';
const DISTRO_M3U = 'https://www.apsattv.com/distro.m3u';
const LG_M3U = 'https://www.apsattv.com/uslg.m3u';
const FAV_KEY = 'jpx-livetv-favorites';
const FAV_CAT = '★ Favorites';
const ROW_H = 60;
// Grid guide geometry.
const GRID_ROW_H = 56;      // channel row height in the guide
const GRID_HOURS = 6;       // width of the visible timeline
const PX_PER_MIN = 6;       // horizontal scale
const GRID_LEFT_W = 200;    // sticky channel-name column width
const SLOT_MIN = 30;        // time-header granularity

interface Prog { title: string; start: number; stop: number }
interface Channel { id: string; name: string; logo: string; category: string; provider: string; url: string; tvgId?: string; sched?: Prog[] }

function getFavs(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); } }
function saveFavs(s: Set<string>) { try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }

// Channels whose source has died (dead CDN / 404 / DNS) are hidden so third-party list rot
// self-prunes as it's discovered. Persisted with a 3-day TTL so a recovered channel reappears.
const DEAD_KEY = 'jpx-livetv-dead';
const DEAD_TTL = 3 * 24 * 3600 * 1000;
function getDead(): Set<string> {
    try {
        const m = JSON.parse(localStorage.getItem(DEAD_KEY) || '{}');
        const now = Date.now(); const live: Record<string, number> = {};
        for (const k of Object.keys(m)) if (now - m[k] < DEAD_TTL) live[k] = m[k];
        localStorage.setItem(DEAD_KEY, JSON.stringify(live));
        return new Set(Object.keys(live));
    } catch { return new Set(); }
}
function markDead(id: string) {
    try { const m = JSON.parse(localStorage.getItem(DEAD_KEY) || '{}'); m[id] = Date.now(); localStorage.setItem(DEAD_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// Current + next program from a channel's schedule at time t.
function deriveNowNext(sched: Prog[] | undefined, t: number): { now?: Prog; next?: Prog } {
    if (!sched || !sched.length) return {};
    let now: Prog | undefined; let next: Prog | undefined;
    for (const p of sched) {
        if (t >= p.start && t < p.stop) now = p;
        else if (p.start > t && (!next || p.start < next.start)) next = p;
    }
    return { now, next };
}

function parseM3U(text: string, provider: string, opt: { rewritePlex?: boolean } = {}): Channel[] {
    const out: Channel[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#EXTINF')) continue;
        const logo = (line.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
        const tvgId = (line.match(/tvg-id="([^"]*)"/) || [])[1] || '';
        const category = (line.match(/group-title="([^"]*)"/) || [])[1] || provider;
        const name = (line.split(',').pop() || '').trim();
        let url = '';
        for (let j = i + 1; j < lines.length; j++) { const u = lines[j].trim(); if (u && !u.startsWith('#')) { url = u; break; } }
        if (opt.rewritePlex && url) {
            const m = url.match(/https?:\/\/[^/]+(:7779|:7777)?(\/.*)/);
            if (m && (url.includes(':7779') || url.includes(':7777'))) url = `${W.plex}/plex${m[2]}`;
        }
        if (name && url) out.push({ id: provider + '_' + (tvgId || name) + '_' + i, name, logo, category, provider, url, tvgId });
    }
    return out;
}

// Plex XMLTV -> channel-id -> future/current schedule (drop already-finished programs to save memory).
function parseXmltv(xml: string): Map<string, Prog[]> {
    const map = new Map<string, Prog[]>();
    try {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const cutoff = Date.now() - 60 * 60 * 1000;
        const parseT = (s: string): number => {
            const m = s.match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-]\d{4})?/);
            if (!m) return NaN;
            const tz = m[7] || '+0000';
            return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz.slice(0, 3)}:${tz.slice(3)}`);
        };
        const progs = doc.getElementsByTagName('programme');
        for (let i = 0; i < progs.length; i++) {
            const p = progs[i];
            const ch = p.getAttribute('channel') || '';
            const s = parseT(p.getAttribute('start') || ''); const e = parseT(p.getAttribute('stop') || '');
            if (!ch || isNaN(s) || isNaN(e) || e < cutoff) continue;
            const title = (p.getElementsByTagName('title')[0]?.textContent || '').trim();
            let arr = map.get(ch); if (!arr) { arr = []; map.set(ch, arr); }
            arr.push({ title, start: s, stop: e });
        }
    } catch { /* ignore */ }
    return map;
}

async function fetchText(url: string): Promise<string> { try { const r = await fetch(url); return r.ok ? r.text() : ''; } catch { return ''; } }

// Some EPGs are served as raw .xml.gz (no Content-Encoding) — decompress with DecompressionStream.
async function fetchTextGz(url: string): Promise<string> {
    try {
        const r = await fetch(url);
        if (!r.ok || !r.body) return '';
        const DS = (window as any).DecompressionStream;
        if (typeof DS !== 'function') return '';
        return await new Response(r.body.pipeThrough(new DS('gzip'))).text();
    } catch { return ''; }
}

// Provider EPG feeds (XMLTV, matched to channels by tvg-id). Pluto uses inline timelines instead;
// Tubi/DistroTV/LG have no readily-matching XMLTV, so they show "Live programming".
const EPG_SOURCES: Array<{ provider: string; url: string; gz: boolean }> = [
    { provider: 'Plex Live', url: `${W.plex}/plex/epg.xml`, gz: false },
    { provider: 'Roku', url: 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/Roku/all.xml.gz', gz: true },
    { provider: 'Samsung TV Plus', url: 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/SamsungTVPlus/us.xml.gz', gz: true },
    { provider: 'Xumo', url: 'https://raw.githubusercontent.com/BuddyChewChew/xumo-playlist-generator/main/playlists/xumo_epg.xml.gz', gz: true }
];

export const Component = () => {
    const [channels, setChannels] = useState<Channel[]>([]);
    const [loading, setLoading] = useState(true);
    const [active, setActive] = useState<Channel | null>(null);
    const [cat, setCat] = useState('All');
    const [query, setQuery] = useState('');
    const [err, setErr] = useState('');
    const [favs, setFavs] = useState<Set<string>>(() => getFavs());
    const [dead, setDead] = useState<Set<string>>(() => getDead());
    const [showInfo, setShowInfo] = useState(true);
    const [nowTs, setNowTs] = useState(() => Date.now());   // ticks so now/next refreshes
    const [scrollTop, setScrollTop] = useState(0);
    const [viewH, setViewH] = useState(700);
    const [view, setView] = useState<'list' | 'grid'>('list');
    const [gScroll, setGScroll] = useState(0);
    const [gViewH, setGViewH] = useState(700);
    const gridRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<any>(null);
    const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const bumpInfo = useCallback(() => {
        setShowInfo(true);
        if (infoTimer.current) clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => setShowInfo(false), 4500);
    }, []);

    const addChannels = useCallback((incoming: Channel[]) => {
        if (!incoming.length) return;
        setChannels(prev => {
            const seen = new Set(prev.map(c => c.id));
            const merged = [...prev, ...incoming.filter(c => !seen.has(c.id))];
            merged.sort((a, b) => a.name.localeCompare(b.name));
            return merged;
        });
    }, []);

    // Refresh "now playing" every 30s.
    useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 30000); return () => clearInterval(t); }, []);

    // Progressive load: every provider appends as it resolves.
    useEffect(() => {
        let dead = false;
        (async () => {
            try {
                const d = await (await fetch(`${W.pluto}/channels`)).json();
                if (dead || !Array.isArray(d)) return;
                addChannels(d.map((c: any): Channel => ({
                    id: 'pluto_' + String(c._id || c.slug), name: String(c.name || ''), logo: (c.logo && c.logo.path) || '',
                    category: String(c.category || 'Pluto'), provider: 'Pluto TV',
                    url: c.proxyStreamUrl || (c.stitched?.urls?.find((u: any) => u.type === 'hls') || {}).url || '',
                    sched: Array.isArray(c.timelines) ? c.timelines.map((tl: any) => ({ title: String(tl.title || ''), start: Date.parse(tl.start), stop: Date.parse(tl.stop) })).filter((p: Prog) => !isNaN(p.start) && !isNaN(p.stop)) : undefined
                })).filter((c: Channel) => !!c.name && !!c.url));
            } catch { /* ignore */ }
        })();
        const m3us: Array<[string, string, boolean]> = [
            [`${W.samsung}/playlist.m3u8?regions=us`, 'Samsung TV Plus', false],
            [`${W.tubi}/tubi/playlist.m3u`, 'Tubi', false],
            [`${W.plex}/plex/playlist.m3u?gracenote=include`, 'Plex Live', true],
            [ROKU_M3U, 'Roku', false],
            [XUMO_M3U, 'Xumo', false],
            [W.hls + encodeURIComponent(DISTRO_M3U), 'DistroTV', false],
            [W.hls + encodeURIComponent(LG_M3U), 'LG Channels', false]
        ];
        for (const [url, provider, rewritePlex] of m3us) {
            (async () => { const txt = await fetchText(url); if (!dead && txt) addChannels(parseM3U(txt, provider, { rewritePlex })); })();
        }
        // EPG: fetch each provider's XMLTV (some gzipped), match to channels by tvg-id, patch in `sched`.
        for (const src of EPG_SOURCES) {
            (async () => {
                const xml = src.gz ? await fetchTextGz(src.url) : await fetchText(src.url);
                if (dead || !xml) return;
                const epg = parseXmltv(xml);
                if (!epg.size) return;
                setChannels(prev => prev.map(c => (c.provider === src.provider && c.tvgId && epg.has(c.tvgId)) ? { ...c, sched: epg.get(c.tvgId) } : c));
            })();
        }
        const spin = setTimeout(() => { if (!dead) setLoading(false); }, 2500);
        return () => { dead = true; clearTimeout(spin); };
    }, [addChannels]);

    // Playback via hls.js.
    useEffect(() => {
        if (!active) return;
        const video = videoRef.current;
        if (!video) return;
        setErr('');
        bumpInfo();
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* ignore */ } hlsRef.current = null; }
        const needsProxy = !active.url.startsWith(FAST_BASE);  // external M3U (Roku/Xumo/Distro/LG) streams need the /hls relay; local base is already proxied
        const finalSrc = needsProxy ? W.hls + encodeURIComponent(active.url) : active.url;
        let cancelled = false;
        import('hls.js/dist/hls.js').then(({ default: Hls }: any) => {
            if (cancelled) return;
            if (Hls.isSupported()) {
                const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                hlsRef.current = hls;
                hls.loadSource(finalSrc);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
                hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
                    if (!data || !data.fatal) return;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && active) {
                        markDead(active.id);                       // dead source -> hide it
                        setDead(prev => { const n = new Set(prev); n.add(active.id); return n; });
                        setErr('That channel is offline — hiding it. Pick another.');
                    } else { setErr('This channel failed to load. Try another.'); }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = finalSrc;
                video.play().catch(() => {});
            } else { setErr('Your browser cannot play this stream.'); }
        }).catch(() => setErr('Player failed to load.'));
        return () => { cancelled = true; };
    }, [active, bumpInfo]);

    useEffect(() => () => { if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* ignore */ } } if (infoTimer.current) clearTimeout(infoTimer.current); }, []);

    // Keep the windowing viewport height in sync.
    useEffect(() => { const el = listRef.current; if (!el) return; const set = () => setViewH(el.clientHeight || 700); set(); const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect(); }, [view]);
    useEffect(() => { const el = gridRef.current; if (!el) return; const set = () => setGViewH(el.clientHeight || 700); set(); const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect(); }, [view]);

    // Play a channel; from the grid, drop back to the list so the player is visible.
    const playChannel = useCallback((ch: Channel) => { setActive(ch); setView('list'); }, []);

    const toggleFav = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        setFavs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); saveFavs(n); return n; });
    }, []);

    const cats = useMemo(() => ['All', ...(favs.size ? [FAV_CAT] : []), ...Array.from(new Set(channels.map(c => c.category))).sort()], [channels, favs]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return channels.filter(c => {
            if (dead.has(c.id)) return false;
            if (cat === FAV_CAT) { if (!favs.has(c.id)) return false; } else if (cat !== 'All' && c.category !== cat) return false;
            return !q || c.name.toLowerCase().includes(q);
        });
    }, [channels, cat, query, favs, dead]);

    // Reset scroll when the filtered set changes.
    useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; setScrollTop(0); }, [cat, query]);

    const activeNow = useMemo(() => active ? deriveNowNext(active.sched, nowTs) : {}, [active, nowTs]);

    // ---- list windowing ----
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
    const end = Math.min(shown.length, Math.ceil((scrollTop + viewH) / ROW_H) + 6);
    const slice = shown.slice(start, end);

    // ---- grid guide layout ----
    const winStart = useMemo(() => Math.floor(nowTs / (SLOT_MIN * 60000)) * (SLOT_MIN * 60000), [nowTs]);
    const winEnd = winStart + GRID_HOURS * 3600000;
    const totalMin = GRID_HOURS * 60;
    const gridW = totalMin * PX_PER_MIN;
    const slots = useMemo(() => {
        const out: number[] = [];
        for (let t = winStart; t < winEnd; t += SLOT_MIN * 60000) out.push(t);
        return out;
    }, [winStart, winEnd]);
    const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // Program blocks for one channel, clipped to the window (fallback: one "Live programming" block).
    const blocksFor = useCallback((ch: Channel): Array<{ left: number; width: number; title: string; live: boolean }> => {
        const src = (ch.sched || []).filter(p => p.stop > winStart && p.start < winEnd).sort((a, b) => a.start - b.start);
        const mk = (s: number, e: number, title: string) => {
            const cs = Math.max(s, winStart), ce = Math.min(e, winEnd);
            return { left: ((cs - winStart) / 60000) * PX_PER_MIN, width: Math.max(6, ((ce - cs) / 60000) * PX_PER_MIN), title, live: nowTs >= s && nowTs < e };
        };
        if (!src.length) return [mk(winStart, winEnd, 'Live programming')];
        return src.map(p => mk(p.start, p.stop, p.title || 'Live programming'));
    }, [winStart, winEnd, nowTs]);
    const nowLeft = ((Math.min(Math.max(nowTs, winStart), winEnd) - winStart) / 60000) * PX_PER_MIN;
    // grid vertical windowing
    const gStart = Math.max(0, Math.floor(gScroll / GRID_ROW_H) - 4);
    const gEnd = Math.min(shown.length, Math.ceil((gScroll + gViewH) / GRID_ROW_H) + 4);
    const gSlice = shown.slice(gStart, gEnd);

    if (view === 'grid') {
        return (
            <div className='jpx-guide-view'>
                <div className='jpx-guide-bar'>
                    <div className='jpx-guide-title'>TV Guide<span>{shown.length} channels · {fmtTime(winStart)}–{fmtTime(winEnd)}</span></div>
                    <input className='jpx-livetv-search jpx-guide-search' type='text' placeholder='Search…' value={query} onChange={e => setQuery(e.target.value)} />
                    <select className='jpx-livetv-cat jpx-guide-cat' value={cat} onChange={e => setCat(e.target.value)}>
                        {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className='jpx-guide-toggle'>
                        <button type='button' onClick={() => setView('list')}>List</button>
                        <button type='button' className='on'>Guide</button>
                    </div>
                </div>
                <div className='jpx-guide-scroll' ref={gridRef} onScroll={e => setGScroll((e.target as HTMLDivElement).scrollTop)}>
                    <div className='jpx-guide-inner' style={{ width: GRID_LEFT_W + gridW }}>
                        <div className='jpx-guide-timerow' style={{ width: GRID_LEFT_W + gridW }}>
                            <div className='jpx-guide-corner'>Channel</div>
                            {slots.map(t => <div key={t} className='jpx-guide-slot' style={{ left: GRID_LEFT_W + ((t - winStart) / 60000) * PX_PER_MIN }}>{fmtTime(t)}</div>)}
                        </div>
                        <div className='jpx-guide-rows' style={{ height: shown.length * GRID_ROW_H }}>
                            <div className='jpx-guide-nowline' style={{ left: GRID_LEFT_W + nowLeft, height: shown.length * GRID_ROW_H }} />
                            {gSlice.map((ch, idx) => (
                                <div key={ch.id} className='jpx-guide-row' style={{ top: (gStart + idx) * GRID_ROW_H, width: GRID_LEFT_W + gridW }}>
                                    <button type='button' className={'jpx-guide-chcell' + (active && active.id === ch.id ? ' active' : '')} onClick={() => playChannel(ch)} title={ch.name}>
                                        {ch.logo ? <img src={ch.logo} alt='' loading='lazy' /> : <span className='jpx-guide-chcell-noicon'>{ch.name.slice(0, 1)}</span>}
                                        <span className='jpx-guide-chcell-name'>{ch.name}</span>
                                    </button>
                                    <div className='jpx-guide-track'>
                                        {blocksFor(ch).map((b, bi) => (
                                            <button type='button' key={bi} className={'jpx-guide-prog' + (b.live ? ' live' : '')} style={{ left: b.left, width: b.width }} onClick={() => playChannel(ch)} title={b.title}>
                                                <span className='jpx-guide-prog-title'>{b.title}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='jpx-livetv'>
            <div className='jpx-livetv-main'>
            <div className='jpx-livetv-stage' onPointerMove={bumpInfo} onPointerDown={bumpInfo}>
                <video ref={videoRef} controls autoPlay playsInline className={active ? '' : 'hide'} />
                {!active && <div className='jpx-livetv-placeholder'><span className='material-icons'>live_tv</span><p>Select a channel to start watching</p></div>}
                {active && (
                    <div className={'jpx-livetv-nowplaying' + (showInfo ? '' : ' hide')}>
                        {active.logo ? <img src={active.logo} alt='' /> : null}
                        <div>
                            <div className='jpx-livetv-np-name'>{active.name}</div>
                            <div className='jpx-livetv-np-sub'>{active.provider} · LIVE</div>
                        </div>
                    </div>
                )}
                {err ? <div className='jpx-livetv-err'>{err}</div> : null}
            </div>
            {active && (
                <div className='jpx-livetv-npbar'>
                    {active.logo ? <img src={active.logo} alt='' /> : <span className='jpx-livetv-npbar-noicon'>{active.name.slice(0, 1)}</span>}
                    <div className='jpx-livetv-npbar-info'>
                        <div className='jpx-livetv-npbar-label'><span className='jpx-livetv-dot' />NOW PLAYING · {active.name}</div>
                        <div className='jpx-livetv-npbar-title'>{activeNow.now ? activeNow.now.title : 'Live programming'}</div>
                        {activeNow.next ? <div className='jpx-livetv-npbar-next'>Up next: {activeNow.next.title}</div> : null}
                    </div>
                </div>
            )}
            </div>
            <div className='jpx-livetv-side'>
                <div className='jpx-livetv-head'>Live TV<span>{loading && channels.length === 0 ? 'Loading…' : channels.length + ' channels'}</span></div>
                <div className='jpx-guide-toggle jpx-livetv-toggle'>
                    <button type='button' className='on'>List</button>
                    <button type='button' onClick={() => setView('grid')}>Guide</button>
                </div>
                <input className='jpx-livetv-search' type='text' placeholder='Search channels…' value={query} onChange={e => setQuery(e.target.value)} />
                <select className='jpx-livetv-cat' value={cat} onChange={e => setCat(e.target.value)}>
                    {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className='jpx-livetv-list' ref={listRef} onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
                    {loading && channels.length === 0 ? <div className='jpx-livetv-loading'>Loading channels…</div> : shown.length === 0 ? <div className='jpx-livetv-loading'>No channels.</div> : (
                        <div className='jpx-livetv-list-inner' style={{ height: shown.length * ROW_H }}>
                            {slice.map((ch, idx) => {
                                const np = deriveNowNext(ch.sched, nowTs);
                                return (
                                    <button type='button' key={ch.id} className={'jpx-livetv-ch' + (active && active.id === ch.id ? ' active' : '')} style={{ top: (start + idx) * ROW_H }} onClick={() => setActive(ch)} title={ch.name}>
                                        {ch.logo ? <img src={ch.logo} alt='' loading='lazy' /> : <span className='jpx-livetv-ch-noicon'>{ch.name.slice(0, 1)}</span>}
                                        <span className='jpx-livetv-ch-meta'>
                                            <span className='jpx-livetv-ch-name'>{ch.name}</span>
                                            <span className='jpx-livetv-ch-cat'>{np.now ? <><span className='jpx-livetv-dot' />{np.now.title}</> : ch.category}</span>
                                        </span>
                                        <span className={'jpx-livetv-fav' + (favs.has(ch.id) ? ' on' : '')} role='button' tabIndex={-1} onClick={(e) => toggleFav(ch.id, e)} title='Favorite'>
                                            <span className='material-icons'>{favs.has(ch.id) ? 'star' : 'star_border'}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
