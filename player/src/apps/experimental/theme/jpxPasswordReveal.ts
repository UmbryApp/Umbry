// Umbry — show/hide ("eye") toggle on every password field in the app: the Umbry account screens,
// Forgot PIN, media-server logins (legacy HTML pages), IPTV/Xtream logins, anything added later.
// One observer instead of editing each form. The button is a sibling placed over the right edge of
// the input; React tolerates the extra node, and orphaned buttons are removed with their input.
import './jpxPasswordReveal.scss';

const MARK = 'jpxRevealBound';
let inited = false;

function place(input: HTMLInputElement, btn: HTMLButtonElement): void {
    const parent = input.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const h = input.offsetHeight || 40;
    btn.style.top = (input.offsetTop + (h - 32) / 2) + 'px';
    btn.style.left = (input.offsetLeft + input.offsetWidth - 36) + 'px';
    btn.style.display = input.offsetWidth ? '' : 'none';
}

function bind(input: HTMLInputElement): void {
    if (input.dataset[MARK]) return;
    input.dataset[MARK] = '1';
    input.classList.add('jpx-reveal-input');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jpx-reveal-btn';
    btn.tabIndex = -1; // keep Tab moving between fields
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<span class="material-icons" aria-hidden="true">visibility</span>';
    // mousedown: keep focus (and the caret) in the field
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        const icon = btn.querySelector('.material-icons');
        if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
    });
    input.insertAdjacentElement('afterend', btn);
    (btn as HTMLButtonElement & { __jpxFor?: HTMLInputElement }).__jpxFor = input;
    place(input, btn);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => place(input, btn)).observe(input);
    input.addEventListener('focus', () => place(input, btn));
}

function scan(): void {
    document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(bind);
    document.querySelectorAll<HTMLButtonElement & { __jpxFor?: HTMLInputElement }>('.jpx-reveal-btn').forEach(b => {
        if (!b.__jpxFor || !b.__jpxFor.isConnected) b.remove();
        else place(b.__jpxFor, b);
    });
}

export function initJpxPasswordReveal(): void {
    if (inited || typeof document === 'undefined') return;
    inited = true;
    let queued = false;
    const run = () => { queued = false; scan(); };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
        .observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', () => scan());
    scan();
}

export default initJpxPasswordReveal;
