// Umbry preference store — localStorage-backed, reactive. Holds the Moonfin-custom settings.
// Every pref now applies a real effect: visual prefs toggle a body class or CSS var (styled in
// jpxPrefsEffects.scss), and behavior prefs that map to a real Jellyfin userSetting are bridged
// through to the engine so the app actually honors them. A pref left at its default adds no class
// (absence-of-class == default), so unset users get stock behavior.

import { enableCinemaMode, enableThemeSongs, enableBackdrops, maxDaysForNextUp, enableNextVideoInfoOverlay } from 'scripts/settings/userSettings';
import appSettings from 'scripts/settings/appSettings';
import { schedulePush } from './jpxCloud';

import './jpxPrefsEffects.scss';
import './jpxGlass.scss';

const PREFIX = 'jpx-pref-';
type Listener = (key: string) => void;
const listeners = new Set<Listener>();

export function getPref<T>(key: string, def: T): T {
    try {
        const v = localStorage.getItem(PREFIX + key);
        return v === null ? def : (JSON.parse(v) as T);
    } catch {
        return def;
    }
}

export function hasPref(key: string): boolean {
    try {
        return localStorage.getItem(PREFIX + key) !== null;
    } catch {
        return false;
    }
}

export function setPref(key: string, val: unknown): void {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(val));
    } catch { /* private mode — still applies for this session */ }
    applySideEffect(key, val);
    applyServerBacked(key, val);
    // Home-affecting prefs (Media Bar, home rows) -> reload the home sections so it takes effect now.
    if (/^mediaBar/.test(key) || /_rows$/.test(key) || /^pref_merge_/.test(key) || key === 'pref_home_rows_style' || key === 'pref_merge_recent_rows_by_type') {
        try { document.querySelector('.sections')?.dispatchEvent(new CustomEvent('settingschange', { bubbles: true })); } catch { /* ignore */ }
    }
    listeners.forEach(l => l(key));
    // Umbry: sync this change up to the account backend (debounced; no-op if not signed in).
    try { schedulePush(); } catch { /* ignore */ }
}

export function subscribePrefs(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
}

// Behavior prefs that map 1:1 onto a real Jellyfin userSetting — bridge them so the engine acts on it.
function applyServerBacked(key: string, val: unknown): void {
    try {
        switch (key) {
            case 'pref_enable_cinema_mode': enableCinemaMode(val === true); break;
            case 'themeMusicEnabled': enableThemeSongs(val === true); break;
            case 'pref_show_backdrop': enableBackdrops(val !== false); break;
            case 'pref_next_up_max_days': maxDaysForNextUp(parseInt(String(val), 10) || 0); break;
            case 'pref_autoplay_next_episode': enableNextVideoInfoOverlay(val === true); break;
            case 'pref_auto_login_behavior': appSettings.enableAutoLogin(val !== 'disabled'); break;
            // Always Authenticate = require a password even with a stored token = no auto-login.
            case 'pref_always_authenticate': if (val === true) appSettings.enableAutoLogin(false); break;
            default: break;
        }
    } catch { /* userSettings not ready yet (pre-login) — re-applied on next change */ }
}

function toggleClass(name: string, on: boolean): void {
    document.body.classList.toggle(name, on);
}

// Visual prefs -> a body class (deviation from default) or a CSS custom property.
function applySideEffect(key: string, val: unknown): void {
    const body = document.body;
    const root = document.documentElement.style;
    switch (key) {
        case 'focus_color':
            root.setProperty('--jpx-t-focus-border-color', String(val));
            break;
        case 'pref_oled_mode':
            body.classList.remove('jpx-oled-subtle', 'jpx-oled-vivid');
            if (val === 'subtle') body.classList.add('jpx-oled-subtle');
            if (val === 'vivid') body.classList.add('jpx-oled-vivid');
            break;
        case 'pref_show_backdrop':
            toggleClass('jpx-no-backdrop', val === false);
            break;
        case 'pref_card_focus_expansion':
            toggleClass('jpx-no-focus-expansion', val === false);
            break;
        case 'browsingBackgroundBlurAmount':
            // Emit a full filter value (blur(Npx) or 'none') — a bare 0px filter on the fixed
            // backdrop makes Chromium drop the layer and paint it black (same reason as the
            // details blur). The CSS consumes --jpx-browse-filter on .backdropContainer .backdropImage.
            root.setProperty('--jpx-browse-filter', Number(val) > 0 ? `blur(${Number(val)}px)` : 'none');
            break;
        case 'pref_desktop_ui_scale':
            body.classList.remove('jpx-ui-small', 'jpx-ui-large', 'jpx-ui-xl');
            if (val === 'small') body.classList.add('jpx-ui-small');
            if (val === 'large') body.classList.add('jpx-ui-large');
            if (val === 'xl') body.classList.add('jpx-ui-xl');
            break;

        // ---- appearance / display ----
        case 'pref_watched_indicator_behavior':
            body.classList.remove('jpx-watched-unwatched', 'jpx-watched-never');
            if (val === 'unwatched') body.classList.add('jpx-watched-unwatched');
            if (val === 'never') body.classList.add('jpx-watched-never');
            break;
        case 'navbarOpacity':
            root.setProperty('--jpx-navbar-opacity', String((Number(val) || 100) / 100));
            break;
        case 'poster_size':
            root.setProperty('--jpx-card-scale',
                val === 'small' ? '0.82' : val === 'large' ? '1.15' : val === 'xl' ? '1.32' : '1');
            break;
        case 'home_rows_padding':
            root.setProperty('--jpx-row-padding', `${Number(val)}px`);
            break;
        case 'pref_interface_style':
            body.classList.remove('jpx-ui-apple', 'jpx-ui-material');
            if (val === 'apple') body.classList.add('jpx-ui-apple');
            if (val === 'material') body.classList.add('jpx-ui-material');
            break;

        // ---- details screen ----
        case 'detailsBackgroundBlurAmount':
            // Emit a full filter value (not a bare length). Default/0 -> 'none' so the detail
            // backdrop carries NO filter: a filter on the position:fixed .backdropContainer makes
            // Chromium drop the layer and paint it black when you scroll away and back.
            root.setProperty('--jpx-details-filter', Number(val) > 0 ? `blur(${Number(val)}px)` : 'none');
            break;
        case 'pref_detail_screen_style':
            toggleClass('jpx-details-classic', val === 'classic');
            break;
        case 'pref_detail_expanded_tabs':
            toggleClass('jpx-expanded-tabs', val === true);
            break;
        case 'pref_detail_show_technical_details':
            toggleClass('jpx-hide-tech-details', val === false);
            break;
        case 'pref_hide_details_media_description':
            toggleClass('jpx-hide-overview', val === true);
            break;

        // ---- home / library layout ----
        case 'pref_home_rows_style':
            toggleClass('jpx-rows-modern', val === 'modern');
            break;
        case 'pref_hide_backdrops_in_libraries':
            toggleClass('jpx-hide-lib-backdrops', val === true);
            break;
        case 'pref_show_media_details_on_library_page':
            toggleClass('jpx-hide-lib-details', val === false);
            break;
        case 'pref_group_items_into_collections':
            toggleClass('jpx-group-collections', val === true);
            break;
        case 'pref_syncplay_enabled':
            toggleClass('jpx-syncplay-on', val === true);
            break;

        default:
            break;
    }
}

// All keys whose effect must be re-applied on app start (only if the user has explicitly set them,
// so we never clobber the active theme's or engine's own defaults).
const INIT_KEYS = [
    'focus_color', 'pref_oled_mode', 'pref_show_backdrop', 'pref_card_focus_expansion',
    'browsingBackgroundBlurAmount', 'pref_desktop_ui_scale',
    'pref_watched_indicator_behavior', 'navbarOpacity', 'poster_size', 'home_rows_padding',
    'pref_interface_style', 'detailsBackgroundBlurAmount', 'pref_detail_screen_style',
    'pref_detail_expanded_tabs', 'pref_detail_show_technical_details', 'pref_hide_details_media_description',
    'pref_home_rows_style', 'pref_hide_backdrops_in_libraries', 'pref_show_media_details_on_library_page',
    'pref_group_items_into_collections', 'pref_syncplay_enabled',
    // server-backed behavior mirrors
    'pref_enable_cinema_mode', 'themeMusicEnabled', 'pref_next_up_max_days',
    'pref_autoplay_next_episode', 'pref_auto_login_behavior', 'pref_always_authenticate'
];

/** Re-apply persisted side-effects on app start. */
export function initJpxPrefs(): void {
    for (const k of INIT_KEYS) {
        if (hasPref(k)) {
            const v = getPref(k, null);
            applySideEffect(k, v);
            applyServerBacked(k, v);
        }
    }
}
