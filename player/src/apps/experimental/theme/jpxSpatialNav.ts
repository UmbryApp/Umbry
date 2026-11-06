// Umbry — spatial (D-pad) navigation for the experimental shell on TV / remote.
//
// The experimental React shell has no arrow-key focus movement (arrow keys just scroll the page),
// so a TV remote can't drive it. This adds nearest-in-direction focus movement, scroll-into-view,
// a visible focus ring, and Enter-to-activate. It stays out of the way of mouse users: it only acts
// on arrow/Enter keys, and a mouse move drops the ring. PoC scope: proven on the home screen, but
// the logic is generic (any focusable surface).

import { appRouter } from 'components/router/appRouter';

// Leaf-level clickable targets: real buttons/links plus Jellyfin's `.itemAction` card hit-area.
const SEL = 'button:not([disabled]), a[href], .itemAction';
// Android TV: the remote is the only input, so it must also reach links without an href, custom
// [tabindex]/[role=button] controls and form fields. Desktop keyboard behaviour keeps SEL.
const SEL_TV = SEL + ', [tabindex="0"], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input:not([type="hidden"]):not([disabled]), textarea, select'
    // stock emby-checkbox / MUI FormControlLabel: the real input is a 1px visually-hidden box, so the label is the stop
    + ', label:has(input[type="checkbox"]:not([disabled])), label:has(input[type="radio"]:not([disabled]))';
const isTv = (): boolean => document.documentElement.classList.contains('jpx-tv');
const sel = (): string => (isTv() ? SEL_TV : SEL);
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

type Pt = { x: number; y: number };

let active = false;
let allowFieldFocusUntil = 0; // set when the user presses OK on a text box (that opens the keyboard)
let keyCount = 0; // remote presses so far — a late focus restore must not override a user's move
let userChosen: HTMLElement | null = null; // the control the user last moved to with the arrows — never 'rescued' away from
let started = false;

function isField(el: Element | null): boolean {
    if (!el) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function onPlayer(): boolean {
    return !!document.querySelector('.videoPlayerContainer:not(.hide), .flexableVideoPlayerContainer');
}

// TV: overflow:hidden/clip boxes (e.g. the collapsed nav pill) hide their contents from the remote.
// Scroll containers don't: the remote has to reach off-screen cards so rows and the page can scroll.
let clipCache: Map<Element, { clip: boolean; rect?: DOMRect; fixed?: boolean }> | null = null;
function clippedAway(el: Element, r: DOMRect): boolean {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        let info = clipCache?.get(p);
        if (!info) {
            const cs = getComputedStyle(p);
            const hides = (v: string) => v === 'hidden' || v === 'clip';
            info = (hides(cs.overflowX) || hides(cs.overflowY)) ? { clip: true, rect: p.getBoundingClientRect() } : { clip: false };
            clipCache?.set(p, info);
        }
        if (info.clip && info.rect) {
            const pr = info.rect;
            if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) return true;
        }
    }
    return false;
}

// "Visually hidden" inputs (MUI's slider/checkbox inputs): clipped to nothing but still measurable.
function visuallyHidden(el: Element): boolean {
    if (el.tagName !== 'INPUT') return false;
    const cs = getComputedStyle(el);
    return (cs.clip && cs.clip !== 'auto') || (cs.clipPath && cs.clipPath !== 'none') || parseFloat(cs.opacity) === 0;
}

// TV: Left/Right on a control holding a range slider changes its value by one step.
function nudgeSlider(from: HTMLElement, dir: string): boolean {
    const range = (from.matches('input[type="range"]') ? from : from.querySelector('input[type="range"]')) as HTMLInputElement | null;
    if (!range) return false;
    const step = parseFloat(range.step) || 1, min = parseFloat(range.min) || 0, max = parseFloat(range.max) || 100;
    const next = Math.min(max, Math.max(min, (parseFloat(range.value) || 0) + (dir === 'ArrowRight' ? step : -step)));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(range, String(next)); else range.value = String(next);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function inFixedLayer(el: Element): boolean {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        let info = clipCache?.get(p) as ({ clip: boolean; rect?: DOMRect; fixed?: boolean }) | undefined;
        if (info && info.fixed !== undefined) { if (info.fixed) return true; continue; }
        const fixed = getComputedStyle(p).position === 'fixed';
        if (clipCache) clipCache.set(p, { ...(info || { clip: false }), fixed });
        if (fixed) return true;
    }
    return false;
}

// A scrolling list inside a fixed layer (the Settings drawer) can bring an off-screen row into view —
// e.g. Privacy Policy sits below a tall prose block, fully off screen.
function scrollableToward(el: Element): boolean {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return true;
        if (cs.position === 'fixed') return false;
    }
    return false;
}

// TV: Up/Down with nothing to move to inside a drawer/dialog scrolls its text (e.g. the Privacy Policy
// panel has no controls, only prose). The page itself keeps holding position.
function scrollStep(from: HTMLElement, dir: string): boolean {
    if (dir !== 'ArrowDown' && dir !== 'ArrowUp') return false;
    const down = dir === 'ArrowDown';
    const can = (p: HTMLElement) => {
        const cs = getComputedStyle(p);
        return /(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2
            && (down ? p.scrollTop + p.clientHeight < p.scrollHeight - 1 : p.scrollTop > 0);
    };
    let target: HTMLElement | null = null;
    for (let p = from.parentElement; p && p !== document.body; p = p.parentElement) { if (can(p)) { target = p; break; } }
    if (!target) {
        const layer = from.closest<HTMLElement>('.MuiDrawer-paper, .MuiDialog-paper, [role="dialog"]');
        if (layer) target = Array.from(layer.querySelectorAll<HTMLElement>('*')).find(can) || null;
    }
    if (!target) return false;
    target.scrollBy({ top: (down ? 1 : -1) * Math.round(target.clientHeight * 0.6), behavior: 'smooth' });
    return true;
}

function visible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    if (isTv()) {
        if (clippedAway(el, r)) return false;
        // Off screen is fine when scrolling can bring it in (rows, the page). Off screen inside a fixed
        // layer (a slid-away player bar or panel) can never be seen, so it isn't a stop.
        const off = r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
        if (off && inFixedLayer(el) && !scrollableToward(el)) return false;
    } else if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
    return true;
}

function center(el: Element): Pt {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Leaf clickables only — for a card we want the inner .itemAction, not the wrapper, so Enter
// activates the real navigation target.
// TV: while a full-screen overlay (dialog, drawer, setup prompt) is open, keep the remote inside it
// instead of wandering onto the page behind. Overlays are portalled onto <body>, so look there.
// TV perf: asked several times per key press (every scan, focus memory…) — share one answer per press.
let ovMemo: { t: number; el: HTMLElement | null } | null = null;
function overlayRoot(): HTMLElement | null {
    const now = performance.now();
    if (ovMemo && now - ovMemo.t < 40) return ovMemo.el;
    const el = overlayRootScan();
    ovMemo = { t: performance.now(), el };
    return el;
}
function overlayRootScan(): HTMLElement | null {
    let top: HTMLElement | null = null;
    let topZ = -Infinity;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Portalled overlays sit on <body>; some dialogs render in place, so also look for anything marked
    // as a dialog/modal/backdrop/overlay.
    const hosts = [
        ...(Array.from(document.body.children) as HTMLElement[]).flatMap(h => [h, h.firstElementChild as HTMLElement | null]),
        ...Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], [class*="-backdrop"], [class*="-overlay"], [class*="-modal"]'))
    ];
    for (const host of hosts) {
        for (const el of [host]) {
            if (!el || !(el instanceof HTMLElement)) continue;
            // Only fixed layers can be overlays; a displayed non-fixed element has an offsetParent. This skips
            // the hundreds of in-card '.cardOverlayContainer's without a style lookup each.
            if (el.offsetParent !== null) continue;
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            // Count only the part actually on screen: a panel slid off-screen (a collapsed player) is closed.
            const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
            const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (visW * visH < vw * vh * 0.5) continue;
            if (parseFloat(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
            if (!el.querySelector(SEL_TV)) continue;
            const z = parseInt(cs.zIndex, 10) || 0;
            if (z >= topZ) { topZ = z; top = el; }
            break;
        }
    }
    return top;
}

// TV perf: one scan per key press is shared (best(), currentFocus… all ask within the same handler), and
// the scan looks near the screen first (see collect) — it measured ~53 ms per scan on a Hisense TV.
let candMemo: { t: number; near: boolean; list: HTMLElement[] } | null = null;
// TV leaf rule, cheap: most elements hold no control at all (one querySelector answers that); for the rest
// stop at the first visible nested control instead of measuring them all.
const LEAF_SEL = SEL + ', input, textarea, select';
function hasVisibleControlInside(el: HTMLElement): boolean {
    if (!el.querySelector(LEAF_SEL)) return false;
    for (const c of Array.from(el.querySelectorAll<HTMLElement>(LEAF_SEL))) {
        const r = c.getBoundingClientRect();
        if (r.width >= 6 && r.height >= 6 && !visuallyHidden(c)) return true;
    }
    return false;
}
function candidates(near = false): HTMLElement[] {
    const now = performance.now();
    if (isTv() && candMemo && now - candMemo.t < 40 && (candMemo.near === near || !candMemo.near)) return candMemo.list;
    clipCache = new Map();
    try { const list = collect(near); if (isTv()) candMemo = { t: performance.now(), near, list }; return list; } finally { clipCache = null; }
}

function collect(near = false): HTMLElement[] {
    const tv = isTv();
    const s = sel();
    const scope: ParentNode = (tv && overlayRoot()) || document;
    const all = Array.from(scope.querySelectorAll<HTMLElement>(s));
    const seen = new Set<HTMLElement>();
    const out: HTMLElement[] = [];
    const vh = window.innerHeight, vw = window.innerWidth;
    // Near mode: measure each page section once and skip everything inside the far-off ones, instead of
    // measuring hundreds of cards one by one (~35 µs each on a TV CPU).
    const SECTION = '.verticalSection, .homeSection, .jpx-person-grid, .jpx-tab-panel, .itemsContainer.vertical-wrap';
    const farSections = new Set<Element>();
    if (tv && near) {
        for (const sec of Array.from(document.querySelectorAll(SECTION))) {
            const r = sec.getBoundingClientRect();
            if (r.bottom < -1.2 * vh || r.top > 2.2 * vh) farSections.add(sec);
        }
    }
    for (const el of all) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (tv) {
            if (farSections.size) { const sec = el.closest(SECTION); if (sec && farSections.has(sec)) continue; }
            // Cheap rejects first (size, then distance), before the costly nested-control test below.
            const r = el.getBoundingClientRect();
            if (r.width < 6 || r.height < 6) continue;
            if (near && (r.bottom < -1.2 * vh || r.top > 2.2 * vh || r.right < -vw || r.left > 2 * vw)) continue;
        }
        // Not a leaf if it contains another real control. On TV a nested [role=button] (e.g. a ★ inside
        // a channel row) doesn't disqualify its row: both are stops.
        // On TV only *visible* nested controls count: a library poster's full-card link holds zero-size
        // overlay buttons that only appear on hover.
        if (tv ? hasVisibleControlInside(el) : el.querySelector(s)) continue;
        if (tv && el.closest('.cardFooter, .cardText')) continue; // a card's title link: one stop per card on TV
        if (!visible(el) || (!tv && isField(el)) || (tv && visuallyHidden(el))) continue;
        out.push(el);
    }
    return out;
}

function best(dir: string, from: HTMLElement): HTMLElement | null {
    // TV: Left/Right stay on the same line when anything there qualifies (a morphing card changes
    // size mid-move, which otherwise lets a row title "win").
    if (isTv() && (dir === 'ArrowLeft' || dir === 'ArrowRight')) {
        const fr = from.getBoundingClientRect();
        const line = bestIn(dir, from, el => { const r = el.getBoundingClientRect(); return r.bottom > fr.top + 4 && r.top < fr.bottom - 4; });
        if (line) return line;
        // Nothing on this line: only step to something nearly level and not above it (hero buttons ->
        // slide dots), never leap up or to a far-off part of the screen. At a row's end, stay put.
        return bestIn(dir, from, el => { const cy = center(el).y; return cy >= fr.top - 10 && cy <= fr.bottom + Math.min(150, fr.height * 1.5); });
    }
    return bestIn(dir, from, () => true);
}

function bestIn(dir: string, from: HTMLElement, accept: (el: HTMLElement) => boolean): HTMLElement | null {
    if (isTv()) {
        const hit = bestInList(dir, from, accept, candidates(true));
        return hit || bestInList(dir, from, accept, candidates(false));
    }
    return bestInList(dir, from, accept, candidates());
}
function bestInList(dir: string, from: HTMLElement, accept: (el: HTMLElement) => boolean, list: HTMLElement[]): HTMLElement | null {
    const c = center(from);
    let bestEl: HTMLElement | null = null;
    let bestScore = Infinity;
    const H = 8;
    // TV up/down is row-first: the nearest row in that direction, then the closest item in it.
    const tvVertical = isTv() && (dir === 'ArrowUp' || dir === 'ArrowDown');
    const fromRect = from.getBoundingClientRect();
    const rowPool: Array<{ el: HTMLElement; gap: number; cross: number; along: number }> = [];
    for (const el of list) {
        if (el === from || !accept(el)) continue;
        const t = center(el);
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        let ok = false;
        if (dir === 'ArrowRight') ok = dx > H;
        else if (dir === 'ArrowLeft') ok = dx < -H;
        else if (dir === 'ArrowDown') ok = dy > H;
        else ok = dy < -H;
        if (ok && isTv() && !el.contains(from) && !from.contains(el)) {
            // TV: the target must lie beyond the current control's edge, not merely have its centre
            // shifted (a morphing card changes size, which moves its neighbours' centres).
            // The target must start beyond the current control's centre in that direction (tall rows
            // may overlap a little; a same-row neighbour of a morphing card shares its top, so it fails).
            const fr = from.getBoundingClientRect(), r = el.getBoundingClientRect();
            const fcx = fr.left + fr.width / 2, fcy = fr.top + fr.height / 2;
            // Left/Right also accept a target that overlaps horizontally (a sticky channel column over
            // a very wide programme block) — the centre test above already says it lies that way.
            const hOverlap = r.left < fr.right && r.right > fr.left;
            if (dir === 'ArrowRight') ok = r.left >= fcx || hOverlap;
            else if (dir === 'ArrowLeft') ok = r.right <= fcx || hOverlap;
            else if (dir === 'ArrowDown') ok = r.top >= fcy;
            else ok = r.bottom <= fcy;
        }
        if (!ok) continue;
        const along = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
        let cross = (dir === 'ArrowLeft' || dir === 'ArrowRight') ? Math.abs(dy) : Math.abs(dx);
        // TV: going up/down from something much wider than its target (a search box, a tab strip),
        // land on the first item of the next row (reading order) — Down from the search box goes to
        // the first result. The small weight keeps a nearer row winning over a farther one.
        if (isTv() && (dir === 'ArrowUp' || dir === 'ArrowDown')) {
            const fr = from.getBoundingClientRect(), r = el.getBoundingClientRect();
            if (fr.width >= 400 && fr.width > r.width * 2) cross = Math.max(0, r.left) / 10;
        }
        if (tvVertical) {
            const r = el.getBoundingClientRect();
            const gap = dir === 'ArrowDown' ? r.top - fromRect.bottom : fromRect.top - r.bottom;
            rowPool.push({ el, gap, cross, along });
            continue;
        }
        const score = along + cross * 3; // penalise cross-axis drift so we stay in-line
        if (score < bestScore) { bestScore = score; bestEl = el; }
    }
    if (tvVertical && rowPool.length) {
        // Rows that sit under/over the current control come first (so Down from the hero's Play goes to
        // the row below, not the slide dots at the far right); anything else only if nothing lines up.
        // A wide source (search box, a full-width form row) gets more slack, but still must not jump
        // into a different column (the dashboard's side menu) while something lines up beneath it.
        const wide = fromRect.width >= 400;
        const overlaps = rowPool.filter(p => {
            const r = p.el.getBoundingClientRect();
            if (wide) { const cx = r.left + r.width / 2; return cx > fromRect.left - 60 && cx < fromRect.right + 60; }
            return r.left < fromRect.right + 60 && r.right > fromRect.left - 60;
        });
        // (a wide source like the search box uses reading order within the row — see the cross rule above)
        const pool = overlaps.length ? overlaps : rowPool;
        const nearest = Math.min(...pool.map(p => p.gap));
        const row = pool.filter(p => p.gap <= nearest + 40); // a row title and its "−" count as one row
        row.sort((a, b) => (a.cross - b.cross) || (a.along - b.along));
        return row[0].el;
    }
    return bestEl;
}

// TV: the ring is drawn just inside the control (2px, inset) so it never gets clipped by its container
// (nav pill, cast row) or overlaps neighbours; it keeps the control's own shape (round stays round).
function ringOn(el: HTMLElement): void {
    if (isTv() && !el.classList.contains('jpx-sn-focus')) {
        const r = getComputedStyle(el).borderRadius;
        if (r && r !== '0px') el.style.setProperty('--jpx-sn-r', r); else el.style.removeProperty('--jpx-sn-r');
    }
    el.classList.add('jpx-sn-focus');
}
(window as unknown as { __jpxRingOn?: (el: HTMLElement) => void }).__jpxRingOn = ringOn;
// Test tooling: lets the TV test scripts ask the engine what it sees.
(window as unknown as { __jpxSN?: unknown }).__jpxSN = { candidates: () => candidates(), best: (dir: string, from: HTMLElement) => best(dir, from), overlayScan: () => overlayRootScan() };

function clearRing(): void {
    document.querySelectorAll('.jpx-sn-focus').forEach(e => e.classList.remove('jpx-sn-focus'));
}

function setFocus(el: HTMLElement | null): void {
    clearRing();
    if (!el) return;
    // TV: landing on a text field only highlights it; OK focuses it (which opens the keyboard), so
    // moving past a field doesn't pop the on-screen keyboard over half the screen.
    if (isTv() && (isTextField(el) || el.tagName === 'SELECT')) {
        const a = document.activeElement as HTMLElement | null;
        if (a && a !== document.body) { try { a.blur(); } catch { /* ignore */ } }
    } else {
        try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    ringOn(el);
    if (isTv() && !overlayRoot() && !autoPicking) rememberFocus(el); // remember only the user's own moves
    if (isTv()) {
        // Centre the focused row on screen, and centre the card within its own row. (The page itself
        // can't scroll sideways on TV: overflow-x is clipped in jpxTv.scss.)
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 2) {
                const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
                const delta = (r.left + r.width / 2) - (pr.left + pr.width / 2);
                p.scrollBy({ left: delta, behavior: 'smooth' });
                break;
            }
        }
    } else {
        el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
}

function isTextField(el: Element | null): boolean {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
}

function currentFocus(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && visible(a)) return a;
    const marked = document.querySelector<HTMLElement>('.jpx-sn-focus');
    if (marked && visible(marked)) return marked;
    return null;
}

// ===== TV book / comic / PDF readers =====
// "Page mode" (nothing highlighted) is the default: Left/Right turn pages (the reader's own keys).
// Up enters the top toolbar, Down the bottom bar; inside a bar Left/Right move between its buttons
// without turning pages, and leaving the bar (Down from the top one, Up from the bottom one) returns
// to page mode.
const READER_SEL = '#bookPlayer, #comicsPlayer, #pdfPlayer';
function openReader(): HTMLElement | null {
    if (!isTv()) return null;
    const r = document.querySelector<HTMLElement>(READER_SEL);
    return r && r.isConnected && r.getBoundingClientRect().width > 0 ? r : null;
}
function readerZone(el: Element): 'top' | 'bottom' | null {
    const c = center(el);
    if (c.y < window.innerHeight * 0.25) return 'top';
    if (c.y > window.innerHeight * 0.75) return 'bottom';
    return null;
}
function readerKey(e: KeyboardEvent, reader: HTMLElement): boolean {
    const a = currentFocus();
    const zone = a && reader.contains(a) ? readerZone(a) : null;
    const inZone = (z: 'top' | 'bottom') => candidates().filter(el => reader.contains(el) && readerZone(el) === z)
        .sort((x, y) => center(x).x - center(y).x);
    const pageMode = () => {
        const f = document.activeElement as HTMLElement | null;
        if (f && reader.contains(f)) { try { f.blur(); } catch { /* ignore */ } }
        clearRing();
    };
    if (!zone) { // page mode
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { clearRing(); return true; } // reader turns the page
        const bar = inZone(e.key === 'ArrowUp' ? 'top' : 'bottom');
        e.preventDefault(); e.stopPropagation();
        if (bar.length) { active = true; setFocus(e.key === 'ArrowUp' ? bar[bar.length - 1] : bar[0]); }
        return true;
    }
    e.preventDefault(); e.stopPropagation(); // in a bar: never also turn the page
    if ((zone === 'top' && e.key === 'ArrowDown') || (zone === 'bottom' && e.key === 'ArrowUp')) { pageMode(); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const bar = inZone(zone);
        const i = bar.indexOf(a as HTMLElement);
        const next = bar[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) { active = true; setFocus(next); }
    }
    return true;
}

function onKey(e: KeyboardEvent): void {
    if (ARROWS.includes(e.key) || e.key === 'Enter') keyCount++;
    if (onPlayer()) return;
    const reader = ARROWS.includes(e.key) ? openReader() : null;
    if (reader && !isField(document.activeElement) && readerKey(e, reader)) return;
    if (isField(document.activeElement)) {
        // TV: Up/Down while typing in a single-line field moves on to the next control; everything
        // else (Left/Right caret, typing, Enter to submit) stays with the field.
        const a = document.activeElement as HTMLElement;
        const inp = a as HTMLInputElement;
        // TV: OK on a (visually hidden) checkbox/radio that holds DOM focus toggles it — Enter alone doesn't.
        if (isTv() && e.key === 'Enter' && a.tagName === 'INPUT' && /^(checkbox|radio)$/.test(inp.type)) { e.preventDefault(); inp.click(); return; }
        // TV: Right at the end of the text / Left at its start leaves the field (e.g. to a password-reveal button).
        let edgeMove = false;
        try {
            edgeMove = isTv() && a.tagName === 'INPUT' && inp.selectionStart === inp.selectionEnd
                && ((e.key === 'ArrowRight' && inp.selectionEnd === inp.value.length) || (e.key === 'ArrowLeft' && inp.selectionStart === 0));
        } catch { /* inputs without a caret */ }
        const selectMove = isTv() && a.tagName === 'SELECT' && ARROWS.includes(e.key);
        if (!selectMove && !edgeMove && (!isTv() || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown'))) return;
        const next = best(e.key, a);
        e.preventDefault();
        if (next) { active = true; setFocus(next); }
        return;
    }
    if (ARROWS.includes(e.key)) {
        const from = currentFocus();
        if (!from) {
            const list = candidates();
            if (list.length) { e.preventDefault(); active = true; setFocus((isTv() && startPick(list)) || list[0]); }
            return;
        }
        if (isTv() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && nudgeSlider(from, e.key)) { e.preventDefault(); return; }
        const next = best(e.key, from);
        if (next) { e.preventDefault(); active = true; setFocus(next); userChosen = next; }
        else { e.preventDefault(); if (isTv()) scrollStep(from, e.key); } // hold position; TV: scroll text-only panels
        // TV: MUI menus/listboxes move focus on arrows themselves (and wrap) — without this one press moved two items.
        if (isTv() && from.closest('[role="menu"], [role="listbox"]')) e.stopPropagation();
    } else if (e.key === 'Enter') {
        const from = currentFocus();
        if (from) lastOkEl = from;
        if (!from) {
            if (isTv()) { const list = candidates(); if (list.length) { e.preventDefault(); active = true; setFocus(startPick(list) || list[0]); } }
            return;
        }
        if (isTv() && from.tagName === 'SELECT') { // OK on a highlighted drop-down: open its picker
            e.preventDefault();
            try { from.focus(); } catch { /* ignore */ }
            const sel = from as HTMLSelectElement & { showPicker?: () => void };
            try { if (sel.showPicker) sel.showPicker(); else sel.click(); } catch { sel.click(); }
            return;
        }
        if (isTv() && isTextField(from)) { // OK on a highlighted field: focus it -> keyboard opens
            e.preventDefault();
            allowFieldFocusUntil = Date.now() + 1500;
            try { from.focus(); } catch { /* ignore */ }
            return;
        }
        const t = from.tagName;
        // TV: OK that swaps what's on screen (a settings sub-page, a new screen) leaves the old control
        // hidden — move the remote to the new content's start rather than measuring from a ghost.
        if (isTv()) {
            setTimeout(() => {
                const r = from.getBoundingClientRect();
                const gone = !from.isConnected || r.width === 0 || !visible(from)
                    || document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === null
                    || !(from.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)));
                if (gone) { from.classList.remove('jpx-sn-focus'); ensureStartFocus(0); }
            }, 450);
        }
        if (t === 'BUTTON' || (t === 'A' && from.getAttribute('href'))) return; // native activation
        e.preventDefault();
        from.click();
    }
}

// TV: a remote user needs to see where they are the moment a screen or dialog appears. When nothing
// is focused, highlight a sensible starting control. Text fields only get the ring, so the keyboard
// doesn't pop open.
const START_PREF = '.jpx-mp-play, .jpx-dh-play, .jpx-alb-play, .jpx-hero-play, .jpx-livetv-ch.active, .jpx-livetv-ch, .jpx-guide-chcell, [autofocus]:not(input):not(textarea), .jpx-account-submit, .button-submit, .jpx-srvc-primary';
let startTimer: ReturnType<typeof setTimeout> | null = null;
// TV: remember where focus was on each screen, so Back lands on the card you opened, not the top.
// Screens like Home rebuild their rows when you come back, so also keep the item id + control class
// to find the new copy of the same card.
const lastFocus = new Map<string, HTMLElement>();
const lastKey = new Map<string, { id: string; cls: string }>();
function rememberFocus(el: HTMLElement): void {
    lastFocus.set(location.hash, el);
    const holder = el.closest<HTMLElement>('[data-id]');
    if (holder) lastKey.set(location.hash, { id: holder.getAttribute('data-id') || '', cls: String(el.className).split(' ')[0] });
    else lastKey.delete(location.hash);
}
function recallFocus(list: HTMLElement[]): HTMLElement | null {
    const el = lastFocus.get(location.hash);
    if (el && el.isConnected && list.includes(el)) return el;
    const k = lastKey.get(location.hash);
    if (!k || !k.id) return null;
    return list.find(c => c.closest('[data-id]')?.getAttribute('data-id') === k.id && String(c.className).split(' ')[0] === k.cls)
        || list.find(c => c.closest('[data-id]')?.getAttribute('data-id') === k.id) || null;
}
// Hero Play first; else a form's first empty text box (the thing you have to fill in); else the
// main button. On-screen candidates only.
// Close / back / cancel controls are a poor place to start when there's real content to reach.
function isDismiss(el: HTMLElement): boolean {
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase();
    return /\b(close|cancel|back|dismiss|minimi[sz]e|collapse)\b/.test(aria)
        || /^(close|cancel|back|arrow_back|expand_more|done|not now|skip|×|✕)$/.test(text);
}
function startPick(list: HTMLElement[]): HTMLElement | undefined {
    const onScreen = list.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth; });
    return onScreen.find(el => el.matches('.jpx-hero-play, .jpx-dh-play, .jpx-alb-play'))
        || onScreen.find(el => isTextField(el) && !(el as HTMLInputElement).value && (!!el.closest('form') || !!overlayRoot()))
        || onScreen.find(el => el.matches(START_PREF))
        || onScreen.find(el => !el.closest('.jpx-nav') && !isDismiss(el))
        || onScreen.find(el => !el.closest('.jpx-nav'))
        || onScreen[0];
}
let startKeyCount = 0;
let autoPicking = false; // set while the start-focus logic (not the user) places focus
function autoSetFocus(el: HTMLElement | null): void {
    autoPicking = true;
    try { setFocus(el); } finally { autoPicking = false; }
}
function ensureStartFocus(delay = 450, restore = false, upgrade = false): void {
    if (!isTv()) return;
    startKeyCount = keyCount;
    if (startTimer) clearTimeout(startTimer);
    startTimer = setTimeout(() => {
        startTimer = null;
        if (onPlayer()) return;
        const reader = openReader();
        if (reader) { // readers start in page mode (nothing highlighted)
            const f = document.activeElement as HTMLElement | null;
            if (f && reader.contains(f) && !readerZone(f)) return;
            if (f && reader.contains(f) && keyCount === startKeyCount && !f.classList.contains('jpx-sn-focus')) { try { f.blur(); } catch { /* ignore */ } clearRing(); }
            return;
        }
        const a = document.activeElement as HTMLElement | null;
        const ring = document.querySelector<HTMLElement>('.jpx-sn-focus');
        const list = candidates();
        if (!list.length) return;
        const inList = (el: HTMLElement | null) => !!el && list.includes(el);
        const back = recallFocus(list);
        const canRestore = !!back;
        if (restore && back && back !== a) { active = true; autoSetFocus(back); return; }
        const cur = (a && a !== document.body && inList(a)) ? a : (ring && inList(ring) && visible(ring) ? ring : null);
        if (cur) {
            // A late retry: content that loaded after the screen appeared (a channel list, rows) may
            // offer a better start than the fallback we picked — move there if the user hasn't moved.
            const pick = upgrade && !back ? startPick(list) : undefined;
            // Also leave a fallback start on the nav pill once real content has arrived.
            if (pick && pick !== cur && !cur.matches(START_PREF) && (pick.matches(START_PREF) || (cur.closest('.jpx-nav') && !pick.closest('.jpx-nav')))) { active = true; autoSetFocus(pick); return; }
            // A dialog/drawer that put focus on its own close button: start on its content instead.
            if (isDismiss(cur) && cur !== userChosen && keyCount === startKeyCount) {
                const better = startPick(list);
                if (better && better !== cur && !isDismiss(better)) { active = true; autoSetFocus(better); }
            }
            return;
        }
        active = true;
        const chosen = (canRestore ? back : null) || startPick(list) || list[0];
        autoSetFocus(chosen);
        // Only the nav pill was on screen yet (content still loading on a slow TV): look again shortly
        // and move to the real content once it's there, unless the user has started moving.
        if (chosen && chosen.closest('.jpx-nav') && !upgrade) {
            const n = keyCount;
            for (const ms of [1500, 4000, 8000]) setTimeout(() => { if (keyCount === n) ensureStartFocus(0, false, true); }, ms);
        }
    }, delay);
}

// TV remote Back (called by MainActivity): close whatever is open, else go back a screen. Returns
// false on Home so the app drops to the background like any TV app.
// Closed-but-kept-mounted MUI menus (the dashboard's User Menu) carry MuiModal-hidden + visibility:hidden.
const OPEN_OVERLAY = '.MuiModal-root:not(.MuiModal-hidden), .MuiPopover-root:not(.MuiModal-hidden), .MuiDrawer-modal:not(.MuiModal-hidden)';
// TV: the control whose OK opened the current overlay — Back that closes the overlay returns there.
let lastOkEl: HTMLElement | null = null;
function restoreOpenerSoon(overlay: HTMLElement): void {
    const opener = lastOkEl;
    if (!opener || overlay.contains(opener)) return;
    const tryIt = (n: number) => setTimeout(() => {
        if (overlay.isConnected && overlay.getBoundingClientRect().width > 0 && getComputedStyle(overlay).visibility !== 'hidden') { if (n > 0) tryIt(n - 1); return; }
        if (!opener.isConnected) return;
        const r = opener.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (overlayRoot() && !overlayRoot()!.contains(opener)) return; // another overlay is on top
        active = true; setFocus(opener);
    }, 180);
    tryIt(6);
}

function tvBack(): boolean {
    // 1) The topmost overlay (MUI dialog/drawer/menu, or an Umbry prompt): press its own Cancel/Close
    //    if it has one (so its normal close logic runs), else send it Escape.
    const muiOpen = Array.from(document.querySelectorAll<HTMLElement>(OPEN_OVERLAY)).filter(o => o.getBoundingClientRect().width > 0 && getComputedStyle(o).visibility !== 'hidden');
    // The topmost layer wins: an Umbry prompt (z 100000) opened over the Settings drawer must close
    // first, not the drawer underneath it.
    const zOf = (e: HTMLElement) => { let z = 0; for (let n: HTMLElement | null = e; n && n !== document.body; n = n.parentElement) { const v = parseInt(getComputedStyle(n).zIndex, 10); if (!isNaN(v)) z = Math.max(z, v); } return z; };
    const muiTop = muiOpen[muiOpen.length - 1] || null;
    const own = overlayRoot();
    const top = (muiTop && own && own !== muiTop && !muiTop.contains(own)) ? (zOf(own) > zOf(muiTop) ? own : muiTop) : (muiTop || own);
    if (top) {
        // Prefer the overlay's own Back (a sub-page inside a drawer goes up one level), then Close/Cancel.
        // Only buttons really on screen (hit-tested): drawers keep slid-away sub-pages mounted.
        const onTop = (b: HTMLElement) => {
            const r = b.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return false;
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!hit && (hit === b || b.contains(hit));
        };
        const btns = Array.from(top.querySelectorAll<HTMLElement>('button, [role="button"], a')).filter(onTop);
        const label = (b: HTMLElement) => (b.getAttribute('aria-label') || b.textContent || '').trim();
        // A sub-page's ← goes up one level; a wizard's text "Back" only when it can (it's disabled on
        // step 1 — then Back closes the dialog instead of doing nothing).
        const enabled = (b: HTMLElement) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true';
        const closeBtn = btns.find(b => enabled(b) && (/^arrow_back$/i.test(label(b)) || /^back$/i.test(b.getAttribute('aria-label') || '')))
            || btns.find(b => enabled(b) && /^(cancel|close|expand_more|not now|skip|done|×|✕)$/i.test(label(b)))
            || btns.find(b => enabled(b) && /^back$/i.test(label(b)));
        if (closeBtn) { restoreOpenerSoon(top); closeBtn.click(); return true; }
        const a = document.activeElement as HTMLElement | null;
        const target = a && top.contains(a) ? a : (top.querySelector<HTMLElement>('[role="dialog"], [role="presentation"], .MuiPaper-root') || top);
        restoreOpenerSoon(top);
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        // Umbry prompts without a Cancel/Close close on a backdrop press (their own commit/close logic):
        // if Escape didn't close it, press the backdrop.
        const backdrop = [ top, top.firstElementChild ].find(e => e instanceof HTMLElement && /overlay|backdrop/i.test(String(e.className))) as HTMLElement | undefined;
        if (backdrop) {
            setTimeout(() => {
                if (!backdrop.isConnected || backdrop.getBoundingClientRect().width === 0) return;
                backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }, 150);
        }
        return true;
    }
    // 2) An open nav pill.
    const openNav = document.querySelector<HTMLElement>('.jpx-nav.open .jpx-nav-chevron-btn');
    if (openNav) { openNav.click(); setFocus(document.querySelector<HTMLElement>('.jpx-nav-chevron-btn')); return true; }
    // 3) Back a screen; on Home, let the app go to the background.
    const path = (location.hash.replace(/^#!?/, '').split('?')[0] || '/').toLowerCase();
    // Home's other tabs (Favorites = ?tab=1 …) are a screen of their own: Back returns to the Home tab
    // instead of sending the app to the background.
    if ((path === '/home' || path === '/home.html') && /[?&]tab=[1-9]/.test(location.hash)) { void appRouter.show('home'); return true; }
    if (path === '/' || path === '/home' || path === '/home.html') return false;
    void appRouter.back();
    return true;
}

function onMouse(): void {
    if (active) { active = false; clearRing(); }
}

export function initJpxSpatialNav(): void {
    if (started) return;
    started = true;
    const style = document.createElement('style');
    style.textContent =
        '.jpx-sn-focus{outline:3px solid var(--jpx-accent,#c235ff)!important;outline-offset:3px;border-radius:10px;}'
        + '.jpx-sn-focus.card,.jpx-sn-focus .cardBox,.jpx-sn-focus.itemAction{box-shadow:0 0 0 3px var(--jpx-accent,#c235ff),0 10px 34px rgba(0,0,0,.55)!important;}'
        + 'html.jpx-tv .jpx-sn-focus{outline:2px solid var(--jpx-accent,#c235ff)!important;outline-offset:-2px!important;border-radius:var(--jpx-sn-r,10px);}';
    document.head.appendChild(style);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMouse, { passive: true });
    // Android Back (phones and TV): close the top dialog/drawer, else go back a screen; on Home the
    // app drops to the background (MainActivity asks this before handling Back itself).
    (window as unknown as { __umbryBack?: () => boolean }).__umbryBack = tvBack;
    if (isTv()) {
        // No browser on most TVs: external links become an "open on your phone" QR dialog.
        void import('./jpxTvLink').then(m => m.initJpxTvLinks()).catch(() => { /* ignore */ });
        // (e) the app coming back from the background, or the focused control disappearing (a row
        // collapsing, a list re-rendering), must never leave the remote with nothing focused.
        // The on-screen keyboard never opens by itself on TV: a text box that gets focus any other way
        // (a screen's autofocus) is only highlighted; OK opens the keyboard. Moving from one field to
        // the next while typing (the keyboard's Next key) is left alone.
        // A dialog/drawer that focuses its own close button on open (MUI does): start on its content.
        let lastKeyAt = 0;
        window.addEventListener('keydown', () => { lastKeyAt = Date.now(); }, true);
        document.addEventListener('focusin', (e) => {
            const t = e.target as HTMLElement | null;
            // (also when it focuses its own container — MUI drawers focus their panel)
            if (t && t !== userChosen && (isDismiss(t) || !t.matches(SEL_TV)) && Date.now() - lastKeyAt > 400 && overlayRoot()?.contains(t)) ensureStartFocus(250);
        });
        document.addEventListener('focusin', (e) => {
            const t = e.target as HTMLElement | null;
            if (!t || !isTextField(t) || Date.now() < allowFieldFocusUntil) return;
            if (e.relatedTarget && isTextField(e.relatedTarget as Element)) return;
            t.blur();
            clearRing();
            ringOn(t);
            active = true;
        });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureStartFocus(300); });
        setInterval(() => {
            const a = document.activeElement;
            const ring = document.querySelector('.jpx-sn-focus');
            const ringOk = !!ring && ring.isConnected && visible(ring) && (ring as HTMLElement).getBoundingClientRect().width > 0;
            // Focus on something that can no longer be seen (a panel that slid away) counts as lost.
            const aOk = !!a && a !== document.body && a.isConnected && visible(a);
            if (!aOk && !ringOk && !startTimer) {
                if (a && a !== document.body) { try { (a as HTMLElement).blur(); } catch { /* ignore */ } }
                ensureStartFocus(0, true);
            }
        }, 1500);
        // Restore where you were only when you come BACK to a screen (history pop); opening a screen
        // fresh (the router pushes) starts at its natural start — e.g. a details page's Play.
        let lastPop = 0;
        window.addEventListener('popstate', () => { lastPop = Date.now(); });
        window.addEventListener('hashchange', () => {
            const restore = Date.now() - lastPop < 300;
            if (!restore) { lastFocus.delete(location.hash); lastKey.delete(location.hash); }
            ensureStartFocus(700, restore);
            // Rows load after the screen appears; try the restore again once they're in, unless the
            // user has already moved.
            const n = keyCount;
            for (const ms of [2200, 5000, 9000]) {
                setTimeout(() => { if (keyCount === n) ensureStartFocus(0, true, true); }, ms);
            }
            // Slow TVs can take 20 s+ to load a big list (Live TV's 3,000 channels): for up to 45 s, re-check
            // whenever the page changes, until the user presses a key.
            const until = Date.now() + 45000;
            let t: ReturnType<typeof setTimeout> | null = null;
            const mo = new MutationObserver(() => {
                if (keyCount !== n || Date.now() > until) { mo.disconnect(); return; }
                if (t) clearTimeout(t);
                t = setTimeout(() => { if (keyCount === n) ensureStartFocus(0, true, true); }, 700);
            });
            mo.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => mo.disconnect(), 45000);
        });
        document.addEventListener('viewshow', () => ensureStartFocus(500), true);
        // Dialogs, drawers and setup prompts are portalled onto <body>.
        new MutationObserver(() => ensureStartFocus(450)).observe(document.body, { childList: true });
        ensureStartFocus(1200);
    }
}

export default initJpxSpatialNav;
