// Umbry — spatial (D-pad) navigation for the experimental shell on TV / remote.
//
// The experimental React shell has no arrow-key focus movement (arrow keys just scroll the page),
// so a TV remote can't drive it. This adds nearest-in-direction focus movement, scroll-into-view,
// a visible focus ring, and Enter-to-activate. It stays out of the way of mouse users: it only acts
// on arrow/Enter keys, and a mouse move drops the ring. PoC scope: proven on the home screen, but
// the logic is generic (any focusable surface).

// Leaf-level clickable targets: real buttons/links plus Jellyfin's `.itemAction` card hit-area.
const SEL = 'button:not([disabled]), a[href], .itemAction';
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

type Pt = { x: number; y: number };

let active = false;
let started = false;

function isField(el: Element | null): boolean {
    if (!el) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function onPlayer(): boolean {
    return !!document.querySelector('.videoPlayerContainer:not(.hide), .flexableVideoPlayerContainer');
}

function visible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
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
function candidates(): HTMLElement[] {
    const all = Array.from(document.querySelectorAll<HTMLElement>(SEL));
    const seen = new Set<HTMLElement>();
    const out: HTMLElement[] = [];
    for (const el of all) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (el.querySelector(SEL)) continue; // not a leaf
        if (!visible(el) || isField(el)) continue;
        out.push(el);
    }
    return out;
}

function best(dir: string, from: HTMLElement): HTMLElement | null {
    const c = center(from);
    let bestEl: HTMLElement | null = null;
    let bestScore = Infinity;
    const H = 8;
    for (const el of candidates()) {
        if (el === from) continue;
        const t = center(el);
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        let ok = false;
        if (dir === 'ArrowRight') ok = dx > H;
        else if (dir === 'ArrowLeft') ok = dx < -H;
        else if (dir === 'ArrowDown') ok = dy > H;
        else ok = dy < -H;
        if (!ok) continue;
        const along = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
        const cross = (dir === 'ArrowLeft' || dir === 'ArrowRight') ? Math.abs(dy) : Math.abs(dx);
        const score = along + cross * 3; // penalise cross-axis drift so we stay in-line
        if (score < bestScore) { bestScore = score; bestEl = el; }
    }
    return bestEl;
}

function clearRing(): void {
    document.querySelectorAll('.jpx-sn-focus').forEach(e => e.classList.remove('jpx-sn-focus'));
}

function setFocus(el: HTMLElement | null): void {
    clearRing();
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    el.classList.add('jpx-sn-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function currentFocus(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && visible(a)) return a;
    const marked = document.querySelector<HTMLElement>('.jpx-sn-focus');
    if (marked && visible(marked)) return marked;
    return null;
}

function onKey(e: KeyboardEvent): void {
    if (onPlayer() || isField(document.activeElement)) return;
    if (ARROWS.includes(e.key)) {
        const from = currentFocus();
        if (!from) {
            const list = candidates();
            if (list.length) { e.preventDefault(); active = true; setFocus(list[0]); }
            return;
        }
        const next = best(e.key, from);
        if (next) { e.preventDefault(); active = true; setFocus(next); }
        else { e.preventDefault(); } // hold position rather than scroll off
    } else if (e.key === 'Enter') {
        const from = currentFocus();
        if (!from) return;
        const t = from.tagName;
        if (t === 'BUTTON' || (t === 'A' && from.getAttribute('href'))) return; // native activation
        e.preventDefault();
        from.click();
    }
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
        + '.jpx-sn-focus.card,.jpx-sn-focus .cardBox,.jpx-sn-focus.itemAction{box-shadow:0 0 0 3px var(--jpx-accent,#c235ff),0 10px 34px rgba(0,0,0,.55)!important;}';
    document.head.appendChild(style);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMouse, { passive: true });
}

export default initJpxSpatialNav;
