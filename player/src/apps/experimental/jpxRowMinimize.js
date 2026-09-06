// Umbry — Home-row minimize / restore. Adds an outlined-square button to every home row header
// (any .verticalSection with a .sectionTitle inside .homeSectionsContainer). Clicking it hides that
// row (neighbors reflow because the element stays in place, just display:none) and drops a chip into
// a horizontal strip that sits IN FLOW directly under the hero — so the strip pushes the content rows
// down. Clicking a chip restores the row to its original position (it never left the DOM) and removes
// the chip.
//
// State is PER-SERVER: minimizing a row on Jellyfin/Emby/Plex only affects that server. We store a map
// { "<serverId>": ["title", ...] } under the jpxPrefs key `minimizedRowsByServer`, and on each apply()
// use only the CURRENT server's list. Active server id: Plex first (localStorage `jpx-active-plex`),
// else the live Jellyfin/Emby apiclient (ServerConnections.currentApiClient().serverId()), else the
// persisted `jpx-active-jf` marker. Switching servers re-fires apply() (home is torn down + rebuilt,
// caught by the observer), which reads the NEW server's own set — so rows minimized on the previous
// server are not hidden on the new one.
//
// The home sections render with innerHTML (homesections.js) and the "Recently Added / Latest ..."
// library rows are NESTED .verticalSection elements, so we match ALL descendant .verticalSection rows.
// A refresh / server switch wipes our buttons, hidden classes and the strip, so we re-apply on a
// MutationObserver (childList+subtree) plus a light interval, matching rows by a stable key derived
// from the section title text (with a #N suffix for duplicate titles).
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { getPref, setPref } from './theme/jpxPrefs';

import './jpxRowMinimize.scss';

const PREF_KEY = 'minimizedRowsByServer';
const HIDDEN_CLASS = 'jpx-rowmin-hidden';
const GRADIENT = 'linear-gradient(100deg,#FFC670,#FF9A4B,#C77BD8,#9385F5)';
let inited = false;
let store = {};          // { serverId: [titles] }
let stripSig = null;     // last-rendered strip signature (cheap rebuild guard)
let scheduled = false;

function loadStore() {
    const v = getPref(PREF_KEY, {});
    store = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
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
    return (t.textContent || '').replace(/\s+/g, ' ').trim();
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

function stackIconSvg() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
        + '<rect x="4" y="5" width="16" height="3" rx="1.2"></rect>'
        + '<rect x="4" y="10.5" width="16" height="3" rx="1.2"></rect>'
        + '<rect x="4" y="16" width="16" height="3" rx="1.2"></rect>'
        + '</svg>';
}

function firstLetter(name) {
    const c = (name || '').trim().charAt(0);
    return c ? c.toUpperCase() : '•';
}

// Inject the minimize button into a section header if not already present.
function ensureButton(section, key) {
    const existing = section.querySelector('.jpx-rowmin-btn');
    if (existing) {
        // keep the key fresh (duplicate ordering can shift across re-renders)
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
        const list = listFor(activeServerId());
        if (list.indexOf(k) === -1) {
            list.push(k);
            saveStore();
        }
        apply();
    });

    // Place the button next to the title but never INSIDE a title link (would hijack navigation).
    // Library rows wrap the <h2> in an <a is="emby-linkbutton" class="...sectionTitleTextButton">
    // inside a .sectionTitleContainer — drop the button after that anchor, in the container.
    const anchor = title.closest('a');
    const container = title.closest('.sectionTitleContainer');
    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    } else if (container) {
        container.appendChild(btn);
    } else {
        // bare <h2 class=sectionTitle> — inline the button right after the text
        title.appendChild(btn);
    }
}

// Paint each chip with its own slice of one continuous gradient that spans the whole chip row:
// every chip carries the same gradient sized to the strip's total width, shifted left by the chip's
// own offset — so the pieces line up into one gradient (chip 1 = gold end ... last chip = purple end).
function paintGradient(inner) {
    const chips = inner.querySelectorAll('.jpx-rowmin-chip');
    if (!chips.length) return;
    const totalW = Math.max(1, Math.round(inner.getBoundingClientRect().width));
    chips.forEach((chip) => {
        const left = chip.offsetLeft; // relative to the position:relative inner wrapper
        chip.style.backgroundImage = GRADIENT;
        chip.style.backgroundRepeat = 'no-repeat';
        chip.style.backgroundSize = totalW + 'px 100%';
        chip.style.backgroundPosition = (-left) + 'px 0';
    });
}

// Build / update the in-flow strip of chips directly under the hero so it pushes the rows down.
function renderStrip(entries, home) {
    const sig = entries.map((e) => e.key).join('|');
    let strip = document.getElementById('jpx-rowmin-strip');

    if (!entries.length || !home) {
        if (strip) strip.remove();
        stripSig = '';
        return;
    }

    // (Re)create the strip if it's missing, detached, or no longer inside the current home (a home
    // rebuild via innerHTML destroys it).
    if (!strip || !strip.isConnected || strip.parentNode !== home) {
        if (strip && strip.parentNode) strip.remove();
        strip = document.createElement('div');
        strip.id = 'jpx-rowmin-strip';
        strip.className = 'jpx-rowmin-strip';
        strip.innerHTML = '<div class="jpx-rowmin-strip-inner"></div>';
        // In-flow, right after the hero, so the content rows shift down.
        const hero = home.querySelector('.jpx-hero');
        if (hero && hero.parentNode === home) {
            home.insertBefore(strip, hero.nextSibling);
        } else {
            home.insertBefore(strip, home.firstChild);
        }
        stripSig = null; // force a chip rebuild below
    }

    if (sig === stripSig) {
        // Content unchanged — the strip width can still shift on resize, so re-run the paint cheaply.
        paintGradient(strip.querySelector('.jpx-rowmin-strip-inner'));
        return;
    }
    stripSig = sig;

    const inner = strip.querySelector('.jpx-rowmin-strip-inner');
    inner.innerHTML = '';
    for (const e of entries) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'jpx-rowmin-chip';
        chip.title = e.name;
        chip.setAttribute('aria-label', 'Restore row: ' + e.name);
        chip.setAttribute('data-key', e.key);
        chip.innerHTML = stackIconSvg()
            + '<span class="jpx-rowmin-chip-letter">' + esc(firstLetter(e.name)) + '</span>'
            + '<span class="jpx-rowmin-chip-label">' + esc(e.name) + '</span>';
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
            apply();
        });
        inner.appendChild(chip);
    }
    // Lay the continuous gradient across the freshly-built chips (forces one reflow — fine).
    paintGradient(inner);
}

// The core reconcile: inject buttons, hide/show rows, sync the strip. Cheap + idempotent.
// Uses ONLY the current server's minimized set (per-server state) and re-hides matching rows every
// run — which is what keeps each server independent across switches.
function apply() {
    const home = homeContainer();
    if (!home) {
        // Not on the home screen — nothing to inject; drop the strip so nothing lingers.
        renderStrip([], null);
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
            entries.push({ key: key, name: titleOf(section) });
        } else {
            section.classList.remove(HIDDEN_CLASS);
        }
    });

    renderStrip(entries, home);
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

    // Re-apply on any DOM churn. childList+subtree catches the home being torn down and rebuilt on a
    // data refresh or server switch, AND the moment each library-row .verticalSection frag is appended
    // — so the newly-active server's own minimized set is applied to its fresh rows.
    try {
        const mo = new MutationObserver(() => schedule());
        mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* no MutationObserver — interval below still covers it */ }

    // Fallback safety net + keeps the gradient/strip correct across resizes and route changes.
    setInterval(schedule, 1500);
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);

    schedule();
}

export default initJpxRowMinimize;
