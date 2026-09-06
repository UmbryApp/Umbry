// Umbry — seasonal decoration layer for holiday themes. When a theme declares `seasonalFx`,
// applyTheme() calls applySeasonalFx() to inject a fixed, click-through overlay of animated emoji
// particles (drifting bats, falling snow/leaves/confetti, bursting fireworks + sparkles). All motion
// is CSS (jpxSeasonalFx.scss); this just builds/removes the particles. Ambient effects (the Halloween
// vignette + candle flicker) come from a `jpx-fx-<id>` body class also toggled by applyTheme.

const LAYER_ID = 'jpx-fx-layer';

// per-season particle recipe: emoji, count, and motion type (matches the SCSS animation classes)
const CONFIG = {
    halloween:    { cls: 'halloween',    items: [{ e: '🦇', n: 7, type: 'drift' }], corners: ['🕸️', '🕸️'] },
    xmas:         { cls: 'xmas',         items: [{ e: '❄️', n: 16, type: 'fall' }] },
    thanksgiving: { cls: 'thanksgiving', items: [{ e: '🍁', n: 8, type: 'fall' }, { e: '🍂', n: 6, type: 'fall' }] },
    newyear:      { cls: 'newyear',      items: [{ e: '🎉', n: 5, type: 'fall' }, { e: '🎊', n: 5, type: 'fall' }, { e: '✨', n: 9, type: 'twinkle' }] },
    july4:        { cls: 'july4',        items: [{ e: '🎆', n: 4, type: 'burst' }, { e: '🎇', n: 4, type: 'burst' }, { e: '⭐', n: 8, type: 'twinkle' }] },
    stpatricks:   { cls: 'stpatricks',   items: [{ e: '☘️', n: 8, type: 'fall' }, { e: '🍀', n: 6, type: 'fall' }, { e: '✨', n: 5, type: 'twinkle' }] },
    valentines:   { cls: 'valentines',   items: [{ e: '❤️', n: 6, type: 'fall' }, { e: '💕', n: 5, type: 'fall' }, { e: '💗', n: 5, type: 'fall' }, { e: '✨', n: 4, type: 'twinkle' }] }
};

const rand = (a, b) => a + Math.random() * (b - a);

export function applySeasonalFx(fx) {
    const prev = document.getElementById(LAYER_ID);
    if (prev) prev.remove();

    const cfg = fx && CONFIG[fx];
    if (!cfg) return;
    // Respect reduced-motion: skip the moving particle layer entirely (ambient CSS is also gated).
    try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (e) { /* ignore */ }

    const layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'jpx-fx jpx-fx-' + cfg.cls;
    layer.setAttribute('aria-hidden', 'true');

    (cfg.items || []).forEach((spec) => {
        for (let i = 0; i < spec.n; i++) {
            const p = document.createElement('span');
            p.className = 'jpx-fx-p jpx-fx-' + spec.type;
            p.textContent = spec.e;
            const isDrift = spec.type === 'drift';
            const dur = isDrift ? rand(16, 30) : (spec.type === 'fall' ? rand(7, 15) : rand(2, 4.5));
            p.style.left = rand(-2, 100).toFixed(2) + '%';
            p.style.fontSize = rand(spec.type === 'twinkle' ? 0.8 : 1.0, spec.type === 'twinkle' ? 1.5 : 2.2).toFixed(2) + 'rem';
            p.style.animationDuration = dur.toFixed(2) + 's';
            p.style.animationDelay = (-rand(0, dur)).toFixed(2) + 's';
            p.style.setProperty('--sway', rand(-60, 60).toFixed(0) + 'px');
            p.style.setProperty('--rot', rand(-260, 260).toFixed(0) + 'deg');
            if (isDrift || spec.type === 'twinkle' || spec.type === 'burst') {
                p.style.top = rand(6, 82).toFixed(1) + '%';
            }
            layer.appendChild(p);
        }
    });

    (cfg.corners || []).forEach((e, idx) => {
        const c = document.createElement('span');
        c.className = 'jpx-fx-corner jpx-fx-corner-' + (idx === 0 ? 'tl' : 'tr');
        c.textContent = e;
        layer.appendChild(c);
    });

    document.body.appendChild(layer);
}
