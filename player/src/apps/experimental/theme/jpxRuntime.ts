// Umbry runtime features driven by prefs: Seasonal Effects (snow / confetti / fireworks) and
// Confirm-on-Exit. Self-contained canvas overlay; subscribes to jpxPrefs and reacts live.
import { getPref, subscribePrefs } from './jpxPrefs';

interface P { x: number; y: number; r: number; vx: number; vy: number; rot: number; vr: number; c: string; life: number }
type Mode = 'snow' | 'confetti' | 'fireworks' | null;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let particles: P[] = [];
let mode: Mode = null;

const COLS = ['#c235ff', '#35c2ff', '#ffd23f', '#ff5a5f', '#3fe08f'];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function resize(): void {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function ensureCanvas(): void {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'jpx-seasonal-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1200';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
}

function mk(o: Partial<P>): P {
    return { x: 0, y: 0, r: 3, vx: 0, vy: 0, rot: 0, vr: 0, c: '#fff', life: 1, ...o };
}

function spawn(): void {
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    particles = [];
    if (mode === 'snow') {
        for (let i = 0; i < 120; i++) particles.push(mk({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.5, 4), vy: rnd(0.5, 2), vx: rnd(-0.5, 0.5) }));
    } else if (mode === 'confetti') {
        for (let i = 0; i < 160; i++) particles.push(mk({ x: rnd(0, W), y: rnd(-H, 0), r: rnd(3, 7), vy: rnd(1.5, 4), vx: rnd(-1, 1), rot: rnd(0, 6.28), vr: rnd(-0.2, 0.2), c: COLS[i % COLS.length] }));
    }
}

function burst(x: number, y: number): void {
    const c = COLS[Math.floor(Math.random() * COLS.length)];
    for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 6.283, s = rnd(1, 4);
        particles.push(mk({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c }));
    }
}

function step(): void {
    if (!ctx || !canvas) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (mode === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const p of particles) {
            p.y += p.vy; p.x += p.vx;
            if (p.y > H) { p.y = -5; p.x = rnd(0, W); }
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
    } else if (mode === 'confetti') {
        for (const p of particles) {
            p.y += p.vy; p.x += p.vx; p.rot += p.vr;
            if (p.y > H) { p.y = -5; p.x = rnd(0, W); }
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8); ctx.restore();
        }
    } else if (mode === 'fireworks') {
        if (Math.random() < 0.04) burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.15, H * 0.5));
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.vy += 0.03; p.x += p.vx; p.y += p.vy; p.life -= 0.01;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(step);
}

function pickMode(): void {
    // If several are enabled, priority fireworks > confetti > snow.
    const next: Mode = getPref('seasonal_fireworks', false) ? 'fireworks'
        : getPref('seasonal_confetti', false) ? 'confetti'
            : getPref('seasonal_snow', false) ? 'snow' : null;
    if (next === mode) return;
    mode = next;
    cancelAnimationFrame(raf);
    if (!mode) {
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }
    ensureCanvas();
    if (mode === 'fireworks') particles = []; else spawn();
    raf = requestAnimationFrame(step);
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
    if (getPref('confirm_exit', false)) { e.preventDefault(); e.returnValue = ''; }
}

// ---------- Clock (General Style > Clock Display + 24-Hour Clock) ----------
let clockEl: HTMLDivElement | null = null;
let clockTimer = 0;

function ensureClock(): void {
    if (clockEl) return;
    clockEl = document.createElement('div');
    clockEl.className = 'jpx-clock';
    clockEl.style.cssText = 'position:fixed;top:0.85rem;right:1.1rem;z-index:1250;font-weight:600;font-size:0.95rem;'
        + 'color:#fff;background:rgba(18,18,24,0.55);backdrop-filter:blur(10px);padding:0.32em 0.7em;border-radius:10px;'
        + 'pointer-events:none;letter-spacing:0.5px;box-shadow:0 2px 10px rgba(0,0,0,0.35);font-variant-numeric:tabular-nums;';
    document.body.appendChild(clockEl);
}

function tickClock(): void {
    const behavior = getPref('pref_clock_behavior', 'never');
    if (behavior === 'never') { if (clockEl) clockEl.style.display = 'none'; return; }
    ensureClock();
    // The clock lives top-right by default; when the nav pill is anchored top-right it would sit
    // under the clock, so flip the clock to top-left to keep both clear.
    const navPos = getPref<string>('pref_navbar_position', 'top-left');
    if (navPos === 'top-right') {
        clockEl!.style.right = 'auto'; clockEl!.style.left = '1.1rem';
    } else {
        clockEl!.style.left = 'auto'; clockEl!.style.right = '1.1rem';
    }
    // 'menus' shows the clock only while a drawer / menu / dialog is open.
    const menuOpen = !!document.querySelector('.jpx-settings-paper, .MuiPopover-root, .MuiDrawer-root .MuiPaper-root, .dialogContainer .dialog');
    clockEl!.style.display = (behavior === 'menus' && !menuOpen) ? 'none' : 'block';

    const d = new Date();
    const h24 = getPref('pref_use_24_hour_clock', false);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    let suffix = '';
    if (!h24) { suffix = h >= 12 ? ' PM' : ' AM'; h = h % 12; if (h === 0) h = 12; }
    clockEl!.textContent = `${h24 ? String(h).padStart(2, '0') : h}:${m}${suffix}`;
}

function startClock(): void {
    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = window.setInterval(tickClock, 1000);
}

let started = false;
export function initJpxRuntime(): void {
    if (started) return;
    started = true;
    pickMode();
    startClock();
    subscribePrefs(() => { pickMode(); tickClock(); });
    window.addEventListener('beforeunload', onBeforeUnload);
}
