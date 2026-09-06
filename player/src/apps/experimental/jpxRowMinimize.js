// Umbry — Home-row minimize / restore. Adds an outlined-square button to every home row header
// (any .verticalSection with a .sectionTitle inside .homeSectionsContainer). Clicking it hides that
// row (display:none, stays in place so neighbours reflow) and drops a POSTER THUMBCARD into a
// collapsible DRAWER that sits IN FLOW directly under the hero.
//
// The drawer: a frosted-glass tab (chevron handle, centre-aligned) toggles it open/closed. Open =
// chevron up, poster chips visible; closed = the chips slide up and are clipped behind the hero bar,
// and the tab sits directly under the hero (chevron down). Each chip is a miniature poster of a random
// item from the row (with a mirror reflection) and the row's name beneath it. Clicking a chip restores
// the row. Drawer open/closed persists (jpxPrefs `minDrawerOpen`, default open).
//
// State is PER-SERVER: minimizing a row on Jellyfin/Emby/Plex only affects that server. Map
// { "<serverId>": ["title", ...] } under jpxPrefs `minimizedRowsByServer`; each apply() uses only the
// CURRENT server's list. Active server id: Plex first, else the live JF/Emby apiclient, else the
// persisted jf marker. A refresh / server switch wipes our DOM (home re-renders via innerHTML), so we
// re-apply on a MutationObserver (childList+subtree) plus a light interval, matching rows by a stable
// key from the section title (with a #N suffix for duplicate titles).
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { getPref, setPref } from './theme/jpxPrefs';

import './jpxRowMinimize.scss';

const PREF_KEY = 'minimizedRowsByServer';
const DRAWER_PREF = 'minDrawerOpen';
const HIDDEN_CLASS = 'jpx-rowmin-hidden';
let inited = false;
let store = {};          // { serverId: [titles] }
let stripSig = null;     // last-rendered drawer signature (cheap rebuild guard)
let scheduled = false;
let drawerOpen = true;   // drawer open/closed (persisted)
const posterCache = {};  // key -> poster url captured at minimize time (best-effort, session-only)

function loadStore() {
    const v = getPref(PREF_KEY, {});
    store = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    drawerOpen = getPref(DRAWER_PREF, true) !== false;
}

function saveStore() {
    setPref(PREF_KEY, store);
}

// Stable identifier for the currently-active server. Plex wins (jpx-active-jf is cleared on a
// switch to Plex), then the live JF/Emby apiclient, then the persisted jf marker.
function activeServerId() {
    try {
        const plex = localStorage.getItem('jpx-active-plex');
        if (plex) return 'plex:' + plex;
    } catch (e) { /* ignore */ }
    try {
        const ac = ServerConnections.currentApiClient && ServerConnections.currentApiClient();
        const sid = ac && ac.serverId && ac.serverId();
        if (sid) return 'jf:' + sid;
    } catch (e) { /* ignore */ }
    try {
        const jf = JSON.parse(localStorage.getItem('jpx-active-jf') || 'null');
        if (jf && jf.id) return 'jf:' + jf.id;
    } catch (e) { /* ignore */ }
    return 'default';
}

function listFor(sid) {
    if (!Array.isArray(store[sid])) store[sid] = [];
    return store[sid];
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The home rows container. Only present on the Home screen.
function homeContainer() {
    return document.querySelector('.homeSectionsContainer');
}

// Section title text, trimmed. Returns '' if the section has no title (skip those).
function titleOf(section) {
    const t = section.querySelector('.sectionTitle');
    if (!t) return '';
    // read only the title's own text, excluding our injected minimize button (its '-' glyph)
    let txt = '';
    t.childNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('jpx-rowmin-btn')) return;
        txt += n.textContent || '';
    });
    return txt.replace(/\s+/g, ' ').trim();
}

// Compute stable keys for the given ordered sections. Duplicate titles get a #N suffix by
// occurrence order so two rows that share a title stay individually addressable.
function computeKeys(sections) {
    const totals = {};
    for (const s of sections) {
        const tt = titleOf(s);
        if (!tt) continue;
        totals[tt] = (totals[tt] || 0) + 1;
    }
    const seen = {};
    return sections.map((s) => {
        const tt = titleOf(s);
        if (!tt) return null;
        if (totals[tt] > 1) {
            const n = (seen[tt] = (seen[tt] || 0) + 1);
            return tt + '#' + n;
        }
        return tt;
    });
}

// Pull one poster URL from an actual item in the row: prefer the emby card background-image, fall
// back to <img> card sources. Returns a random valid url, or null (→ gradient fallback thumbcard).
function posterFor(section) {
    if (!section) return null;
    const urls = [];
    try {
        section.querySelectorAll('.cardImageContainer').forEach((el) => {
            let bg = '';
            try { bg = (el.style && el.style.backgroundImage) || ''; } catch (e) { /* ignore */ }
            if (!bg || bg === 'none') { try { bg = getComputedStyle(el).backgroundImage || ''; } catch (e) { /* ignore */ } }
            const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
            if (m && m[1] && m[1] !== 'none') urls.push(m[1]);
        });
        section.querySelectorAll('.jpx-libcard-collage img, img.cardImage, img.cardImageIcon, img.coveredImage').forEach((el) => {
            const src = (el.getAttribute && el.getAttribute('src')) || el.src;
            if (src) urls.push(src);
        });
    } catch (e) { /* ignore */ }
    const valid = urls.filter((u) => u && u !== 'none' && /^(https?:|data:|blob:|\/)/i.test(u));
    if (!valid.length) return null;
    return valid[Math.floor(Math.random() * valid.length)];
}

function chevronSvg() {
    // Up chevron by default (drawer open). CSS rotates it 180° (→ down) when the drawer is closed.
    return '<svg class="jpx-rowmin-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
        + '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" '
        + 'stroke-linecap="round" stroke-linejoin="round"></path></svg>';
}

// Inject the minimize button into a section header if not already present.
function ensureButton(section, key) {
    const existing = section.querySelector('.jpx-rowmin-btn');
    if (existing) {
        existing.setAttribute('data-key', key);
        return;
    }
    const title = section.querySelector('.sectionTitle');
    if (!title) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jpx-rowmin-btn';
    btn.title = 'Minimize this row';
    btn.setAttribute('aria-label', 'Minimize row');
    btn.setAttribute('data-key', key);
    btn.innerHTML = '<span class="jpx-rowmin-glyph" aria-hidden="true">−</span>';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const k = btn.getAttribute('data-key') || key;
        // capture a poster now, while the row is still visible (best chance the images have loaded)
        const poster = posterFor(section);
        if (poster) posterCache[k] = poster;
        const list = listFor(activeServerId());
        if (list.indexOf(k) === -1) {
            list.push(k);
            saveStore();
        }
        apply();
    });

    // Place the button next to the title but never INSIDE a title link (would hijack navigation).
    const anchor = title.closest('a');
    const container = title.closest('.sectionTitleContainer');
    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    } else if (container) {
        container.appendChild(btn);
    } else {
        title.appendChild(btn);
    }
}

// Set the drawer clip height to match content when open, or 0 when closed (drives the slide).
function setDrawerHeight(drawer) {
    const clip = drawer.querySelector('.jpx-rowmin-drawer-clip');
    const content = drawer.querySelector('.jpx-rowmin-drawer-content');
    if (!clip || !content) return;
    clip.style.maxHeight = drawerOpen ? (content.scrollHeight + 4) + 'px' : '0px';
}

// Build / update the collapsible drawer of poster chips, in flow right under the hero.
function renderDrawer(entries, home) {
    const sig = entries.map((e) => e.key + ':' + (e.poster ? 'p' : 'g')).join('|') + '|' + (drawerOpen ? 'o' : 'c');
    let drawer = document.getElementById('jpx-rowmin-strip');

    if (!entries.length || !home) {
        if (drawer) drawer.remove();
        stripSig = '';
        return;
    }

    // (Re)create if missing/detached/rebuilt (home innerHTML wipe destroys it).
    if (!drawer || !drawer.isConnected || drawer.parentNode !== home) {
        if (drawer && drawer.parentNode) drawer.remove();
        drawer = document.createElement('div');
        drawer.id = 'jpx-rowmin-strip';
        drawer.className = 'jpx-rowmin-drawer';
        drawer.innerHTML =
            '<div class="jpx-rowmin-drawer-clip"><div class="jpx-rowmin-drawer-content"></div></div>'
            + '<button type="button" class="jpx-rowmin-tab" aria-label="Show or hide minimized rows">'
            + chevronSvg() + '</button>';
        const hero = home.querySelector('.jpx-hero');
        if (hero && hero.parentNode === home) {
            home.insertBefore(drawer, hero.nextSibling);
        } else {
            home.insertBefore(drawer, home.firstChild);
        }
        drawer.querySelector('.jpx-rowmin-tab').addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            drawerOpen = !drawerOpen;
            setPref(DRAWER_PREF, drawerOpen);
            drawer.setAttribute('data-open', drawerOpen ? 'true' : 'false');
            setDrawerHeight(drawer);
        });
        stripSig = null;
    }

    drawer.setAttribute('data-open', drawerOpen ? 'true' : 'false');

    if (sig === stripSig) {
        setDrawerHeight(drawer); // keep height right across resizes
        return;
    }
    stripSig = sig;

    const content = drawer.querySelector('.jpx-rowmin-drawer-content');
    content.innerHTML = '';
    for (const e of entries) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'jpx-rowmin-chip';
        chip.title = e.name;
        chip.setAttribute('aria-label', 'Restore row: ' + e.name);
        chip.setAttribute('data-key', e.key);

        const thumb = document.createElement('span');
        thumb.className = 'jpx-rowmin-thumb' + (e.poster ? '' : ' jpx-rowmin-thumb--fallback');
        if (e.poster) thumb.style.backgroundImage = 'url("' + String(e.poster).replace(/"/g, '%22') + '")';

        const label = document.createElement('span');
        label.className = 'jpx-rowmin-chip-label';
        label.textContent = e.name;

        chip.appendChild(thumb);
        chip.appendChild(label);
        chip.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const k = chip.getAttribute('data-key');
            const sid = activeServerId();
            const list = listFor(sid);
            const i = list.indexOf(k);
            if (i !== -1) {
                list.splice(i, 1);
                if (!list.length) delete store[sid];
                saveStore();
            }
            delete posterCache[k];
            apply();
        });
        content.appendChild(chip);
    }
    setDrawerHeight(drawer);
    (window.requestAnimationFrame || window.setTimeout)(() => { try { setDrawerHeight(drawer); } catch (e) { /* ignore */ } });
}

// The core reconcile: inject buttons, hide/show rows, sync the drawer. Cheap + idempotent.
function apply() {
    const home = homeContainer();
    if (!home) {
        renderDrawer([], null);
        return;
    }
    const list = store[activeServerId()] || [];
    const sections = Array.prototype.slice.call(home.querySelectorAll('.verticalSection'));
    const keys = computeKeys(sections);
    const entries = [];

    sections.forEach((section, i) => {
        const key = keys[i];
        if (!key) return; // untitled section — no control, never minimized
        ensureButton(section, key);
        if (list.indexOf(key) !== -1) {
            section.classList.add(HIDDEN_CLASS);
            entries.push({ key: key, name: titleOf(section), poster: posterCache[key] || posterFor(section) });
        } else {
            section.classList.remove(HIDDEN_CLASS);
        }
    });

    renderDrawer(entries, home);
}

function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(() => {
        scheduled = false;
        try { apply(); } catch (e) { /* ignore */ }
    });
}

export function initJpxRowMinimize() {
    if (inited) return;
    inited = true;
    loadStore();

    try {
        const mo = new MutationObserver(() => schedule());
        mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* interval below still covers it */ }

    setInterval(schedule, 1500);
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);

    schedule();
}

export default initJpxRowMinimize;
