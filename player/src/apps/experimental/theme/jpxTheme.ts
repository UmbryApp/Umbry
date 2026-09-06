// Umbry theme engine — applies a JpxThemeSpec by setting CSS variables on :root and toggling
// effect body-classes. Moonfin colors are #AARRGGBB (alpha-first); CSS wants #RRGGBBAA, so we
// convert. This drives the app's look via the --jpx-t-* tokens consumed in jpxThemeTokens.scss.

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events';
import { JPX_THEMES, DEFAULT_THEME_ID, type JpxThemeSpec, type JpxGlow } from './jpxThemes';
import { applySeasonalFx } from './jpxSeasonalFx';
import { getPref, subscribePrefs } from './jpxPrefs';
import './jpxSeasonalFx.scss';

const SEASONAL_FX = ['halloween', 'xmas', 'thanksgiving', 'newyear', 'july4', 'stpatricks', 'valentines'];

// ---- Auto seasonal themes (opt-in): around each holiday, transiently switch to its theme without
// overwriting the user's chosen theme, then revert when the window passes. Toggle: `AUTO_KEY` pref.
const AUTO_KEY = 'pref_auto_seasonal_theme';

// Inclusive [monthIndex 0-11, day] windows -> theme id. The New Year window wraps Dec->Jan.
const SEASON_WINDOWS: { id: string; from: [number, number]; to: [number, number] }[] = [
    { id: 'valentines', from: [1, 10], to: [1, 15] },     // Feb 10–15
    { id: 'stpatricks', from: [2, 13], to: [2, 18] },     // Mar 13–18
    { id: 'july4', from: [6, 1], to: [6, 5] },            // Jul 1–5
    { id: 'halloween', from: [9, 24], to: [9, 31] },      // Oct 24–31
    { id: 'thanksgiving', from: [10, 20], to: [10, 28] }, // Nov 20–28 (covers the 4th Thursday)
    { id: 'christmas', from: [11, 18], to: [11, 26] },    // Dec 18–26
    { id: 'newyear', from: [11, 29], to: [0, 2] }         // Dec 29 – Jan 2 (wraps)
];

const inWindow = (now: Date, from: [number, number], to: [number, number]): boolean => {
    const cur = now.getMonth() * 100 + now.getDate();
    const a = from[0] * 100 + from[1];
    const b = to[0] * 100 + to[1];
    return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
};

const seasonalThemeId = (now: Date): string | null => {
    for (const w of SEASON_WINDOWS) if (inWindow(now, w.from, w.to)) return w.id;
    return null;
};

// The theme to actually apply: the active season's theme when auto is on and we're in a window,
// otherwise the user's chosen (stored) theme. Never persists — the stored choice is untouched.
const resolvedThemeId = (): string => {
    try {
        if (getPref<boolean>(AUTO_KEY, false)) {
            const s = seasonalThemeId(new Date());
            if (s) return s;
        }
    } catch { /* ignore */ }
    return getActiveThemeId();
};

// Themes are per-server: the chosen theme is stored under `${STORE_KEY}:${serverId}` so each
// connected server (Jellyfin/Emby/Plex) can have its own look. The bare STORE_KEY is the fallback
// used before any server is connected and as the baseline for a server that's never been themed
// (so existing single-theme users keep their look until they change it per server).
const STORE_KEY = 'jpx-app-theme';

/** The id of the server the app is currently connected to, or '' if none yet. */
const currentServerId = (): string => {
    try {
        const api = ServerConnections.currentApiClient && ServerConnections.currentApiClient();
        const sid = api && (api as { serverId?: () => string }).serverId?.();
        return sid || '';
    } catch {
        return '';
    }
};

const themeKeyFor = (sid: string): string => (sid ? `${STORE_KEY}:${sid}` : STORE_KEY);

/** Re-apply the theme saved for whichever server is now active (called on server switch). */
export const applyThemeForCurrentServer = (): void => {
    try {
        applyTheme(getThemeById(resolvedThemeId()), false);
    } catch { /* ignore */ }
};

/** '#AARRGGBB' | '#RRGGBB' -> CSS '#RRGGBBAA' | '#RRGGBB'. */
const toCss = (argb: string): string => {
    const h = (argb || '').replace('#', '');
    if (h.length === 8) return '#' + h.slice(2) + h.slice(0, 2);
    if (h.length === 6 || h.length === 3) return '#' + h;
    return argb;
};

/** accent color -> rgba(...) at the given alpha, for derived glows. */
const toRgba = (argb: string, alpha: number): string => {
    const h = (argb || '').replace('#', '');
    const b = h.length === 8 ? h.slice(2) : h;
    if (b.length !== 6) return `rgba(194, 53, 255, ${alpha})`;
    const r = parseInt(b.slice(0, 2), 16);
    const g = parseInt(b.slice(2, 4), 16);
    const bl = parseInt(b.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
};

// #AARRGGBB | #RRGGBB -> "R G B" (MUI colorChannel format for rgb(var(--x) / a)).
const toChannel = (argb: string): string => {
    const h = (argb || '').replace('#', '');
    const b = h.length === 8 ? h.slice(2) : h;
    if (b.length !== 6) return '194 53 255';
    return `${parseInt(b.slice(0, 2), 16)} ${parseInt(b.slice(2, 4), 16)} ${parseInt(b.slice(4, 6), 16)}`;
};

const glowToShadow = (glows: JpxGlow[]): string => {
    if (!glows || !glows.length) return 'none';
    return glows.map(s => `${s.x || 0}px ${s.y || 0}px ${s.blur}px ${s.spread || 0}px ${toCss(s.color)}`).join(', ');
};

const CUSTOM_KEY = 'jpx-custom-themes';

/** User-created themes (from the Theme Editor), persisted in localStorage. */
export const getCustomThemes = (): JpxThemeSpec[] => {
    try {
        const raw = localStorage.getItem(CUSTOM_KEY);
        return raw ? (JSON.parse(raw) as JpxThemeSpec[]) : [];
    } catch {
        return [];
    }
};

export const saveCustomTheme = (spec: JpxThemeSpec): void => {
    const list = getCustomThemes().filter(t => t.id !== spec.id);
    list.push(spec);
    try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    } catch { /* private mode */ }
};

export const deleteCustomTheme = (id: string): void => {
    try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(getCustomThemes().filter(t => t.id !== id)));
    } catch { /* private mode */ }
};

/** Built-in presets + user themes, in picker order. */
export const listAllThemes = (): JpxThemeSpec[] => [ ...JPX_THEMES, ...getCustomThemes() ];

// Migrate the renamed (formerly Moonfin-derived) theme ids so saved selections keep working.
const THEME_ALIASES: Record<string, string> = { jellyplex: 'umbry', moonfin: 'nocturne', neon_pulse: 'nightdrive', glass: 'frost', '8bit_hero': 'arcade' };
export const getThemeById = (id: string): JpxThemeSpec => {
    const rid = THEME_ALIASES[id] || id;
    return listAllThemes().find(t => t.id === rid) || JPX_THEMES.find(t => t.id === DEFAULT_THEME_ID) || JPX_THEMES[0];
};

export const getActiveThemeId = (): string => {
    try {
        const sid = currentServerId();
        if (sid) {
            const perServer = localStorage.getItem(themeKeyFor(sid));
            if (perServer) return perServer;
        }
        // Fallback: the global/legacy theme (baseline for an as-yet-unthemed server), else default.
        return localStorage.getItem(STORE_KEY) || DEFAULT_THEME_ID;
    } catch {
        return DEFAULT_THEME_ID;
    }
};

export const applyTheme = (spec: JpxThemeSpec, persist = true): void => {
    const root = document.documentElement.style;
    const c = spec.colors;
    const set = (name: string, value: string) => root.setProperty(name, value);

    set('--jpx-t-background', toCss(c.background));
    set('--jpx-t-bg-image', spec.bgGradient || 'none');
    // Paint the page ground inline with priority "important": the CONNECTED SERVER's Branding CSS
    // (runtime-injected <style>) paints its own html gradient and out-cascades our stylesheets —
    // inline !important is the only thing that reliably beats it (uniformity principle).
    try {
        document.documentElement.style.setProperty('background-image', spec.bgGradient || 'none', 'important');
        document.documentElement.style.setProperty('background-color', toCss(c.background), 'important');
        document.documentElement.style.setProperty('background-size', 'cover', 'important');
        document.documentElement.style.setProperty('background-repeat', 'no-repeat', 'important');
        document.body.style.setProperty('background', 'transparent', 'important');
    } catch { /* ignore */ }
    set('--jpx-t-on-background', toCss(c.onBackground));
    set('--jpx-t-surface', toCss(c.surface));
    set('--jpx-t-on-surface', toCss(c.onSurface));
    set('--jpx-t-surface-variant', toCss(c.surfaceVariant));
    set('--jpx-t-scrim', toCss(c.scrim));
    set('--jpx-t-accent', toCss(c.accent));
    set('--jpx-t-on-accent', toCss(c.onAccent));
    set('--jpx-t-button-normal', toCss(c.buttonNormal));
    set('--jpx-t-button-focused', toCss(c.buttonFocused));
    set('--jpx-t-on-button-normal', toCss(c.onButtonNormal));
    set('--jpx-t-input-bg', toCss(c.inputBackground));
    set('--jpx-t-input-border', toCss(c.inputBorder));
    set('--jpx-t-input-border-focused', toCss(c.inputBorderFocused));
    set('--jpx-t-range-track', toCss(c.rangeTrack));
    set('--jpx-t-range-progress', toCss(c.rangeProgress));
    set('--jpx-t-range-thumb', toCss(c.rangeThumb));
    set('--jpx-t-card', toCss(c.card || c.surface));
    set('--jpx-t-card-radius', (spec.isPixel ? 0 : spec.borders.cardRadius) + 'px');
    set('--jpx-t-chip-radius', (spec.isPixel ? 0 : spec.borders.chipRadius) + 'px');
    // The "Focus Border Color" picker (pref `focus_color`) overrides the theme's focus colour when
    // set — otherwise applyTheme would clobber the user's choice every time it runs.
    const focusPref = getPref<string>('focus_color', '');
    set('--jpx-t-focus-border-color', focusPref || toCss(spec.borders.focusBorderColor));
    set('--jpx-t-focus-border-width', spec.borders.focusBorderWidth + 'px');
    set('--jpx-t-focus-glow', glowToShadow(spec.borders.focusGlow));
    set('--jpx-t-text-glow', glowToShadow(spec.textGlow || []));

    // Bridge to the legacy --jpx-* vars the nav pill / drawer / auth pages already consume.
    set('--jpx-accent', toCss(c.accent));
    set('--jpx-accent-glow', toRgba(c.accent, 0.5));
    set('--jpx-gradient', spec.gradient || toCss(c.accent));

    // MUI palette bridge — set Jellyfin's --jf-palette-* vars inline so the whole experimental
    // (MUI) app follows the theme. Inline wins over MUI's runtime <style>.
    set('--jf-palette-primary-main', toCss(c.accent));
    set('--jf-palette-primary-dark', toCss(c.accent));
    set('--jf-palette-primary-light', toCss(c.accent));
    set('--jf-palette-primary-contrastText', toCss(c.onAccent));
    set('--jf-palette-primary-mainChannel', toChannel(c.accent));
    set('--jf-palette-background-default', toCss(c.background));
    set('--jf-palette-background-defaultChannel', toChannel(c.background));
    set('--jf-palette-background-paper', toCss(c.surface));
    set('--jf-palette-background-paperChannel', toChannel(c.surface));
    set('--jf-palette-text-primary', toCss(c.onBackground));
    set('--jf-palette-text-secondary', toRgba(c.onBackground, 0.7));
    set('--jf-palette-divider', toRgba(c.onBackground, 0.12));
    set('--jf-palette-FilledInput-bg', toRgba(c.onBackground, 0.06));
    set('--jf-palette-action-hover', toRgba(c.accent, 0.10));
    set('--jf-palette-action-selected', toRgba(c.accent, 0.18));

    // Effect flags -> body classes.
    const body = document.body;
    body.classList.toggle('jpx-glass', !!spec.isGlass);
    body.classList.toggle('jpx-pixel', !!spec.isPixel);
    body.classList.toggle('jpx-neon', !!(spec.textGlow && spec.textGlow.length));
    body.classList.toggle('jpx-nav-transparent', !!spec.transparentNav);

    // Seasonal effects: toggle the ambient body class (vignette/flicker) + (re)build the animated
    // decoration layer (bats / snow / leaves / confetti / fireworks).
    SEASONAL_FX.forEach(f => body.classList.toggle('jpx-fx-' + f, spec.seasonalFx === f));
    try { applySeasonalFx(spec.seasonalFx); } catch (e) { /* decoration is non-critical */ }

    if (persist) {
        try {
            const sid = currentServerId();
            // Persist to the active server's own key so it stays independent of other servers.
            // With no server connected yet, fall back to the global key (boot baseline).
            localStorage.setItem(themeKeyFor(sid), spec.id);
        } catch { /* private mode — theme still applies for this session */ }
    }
};

export const setActiveTheme = (id: string): void => applyTheme(getThemeById(id));

/** Called once at app start to restore the saved theme + re-apply it on every server switch. */
let jpxThemeServerHook = false;
export const initJpxTheme = (): void => {
    applyTheme(getThemeById(resolvedThemeId()), false);
    if (!jpxThemeServerHook) {
        jpxThemeServerHook = true;
        try {
            // Re-apply the per-server theme whenever the active server changes (sign-in / switch).
            Events.on(ServerConnections, 'localusersignedin', applyThemeForCurrentServer);
            // Re-apply instantly when the "Seasonal Themes" toggle is flipped in settings.
            subscribePrefs((key: string) => {
                if (key === AUTO_KEY) applyTheme(getThemeById(resolvedThemeId()), false);
            });
        } catch { /* ignore */ }
    }
};
