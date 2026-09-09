import Drawer from '@mui/material/Drawer';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Dashboard from 'utils/dashboard';
import toast from 'components/toast/toast';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events';

import JpxAppThemeDrawer from './JpxAppThemeDrawer';
import { JPX_PANELS, type JpxPanel, type JpxRow } from './theme/jpxSettingsConfig';
import { getPref, setPref, subscribePrefs } from './theme/jpxPrefs';
import * as userSettings from 'scripts/settings/userSettings';
import appSettings from 'scripts/settings/appSettings';

// Read/write a row's value from its backing store: 'user' = a userSettings method (getter with no
// arg, setter with the value), 'app' = appSettings.get/set, default = jpxPrefs. Keeps native panels
// wired to the SAME settings the stock pages use, so the controls actually take effect.
// --- server-side user Configuration (subtitle mode, languages, autoplay, default audio track) ---
// Loaded once when the drawer opens; edits cache locally then save back to the server (debounced).
let _uc: Record<string, unknown> | null = null;
let _ucId: string | null = null;
let _ucApi: { updateUserConfiguration?: (id: string, c: unknown) => void } | null = null;
let _ucTimer: ReturnType<typeof setTimeout> | null = null;
let _cultures: { value: string; label: string }[] | null = null;
function loadServerData(): Promise<void> {
    try {
        const ac = (ServerConnections as unknown as { currentApiClient?: () => (Record<string, (...a: unknown[]) => Promise<unknown>> & { updateUserConfiguration?: (id: string, c: unknown) => void }) | undefined }).currentApiClient?.();
        if (!ac || typeof ac.getCurrentUser !== 'function') return Promise.resolve();
        const jobs: Promise<unknown>[] = [];
        jobs.push((ac.getCurrentUser() as Promise<{ Id: string; Configuration?: Record<string, unknown> }>).then(u => { _uc = u.Configuration || {}; _ucId = u.Id; _ucApi = ac; }).catch(() => { /* ignore */ }));
        if (!_cultures && typeof ac.getCultures === 'function') {
            jobs.push((ac.getCultures() as Promise<Array<{ DisplayName: string; ThreeLetterISOLanguageName?: string }>>).then(cs => {
                _cultures = [{ value: '', label: 'Any' }].concat(cs.filter(c => c.ThreeLetterISOLanguageName).map(c => ({ value: c.ThreeLetterISOLanguageName as string, label: c.DisplayName })));
            }).catch(() => { /* ignore */ }));
        }
        return Promise.all(jobs).then(() => undefined);
    } catch { return Promise.resolve(); }
}
function ucGet(key: string, def: unknown): unknown { if (!_uc) return def; const v = _uc[key]; return (v === undefined || v === null) ? def : v; }
function ucSet(key: string, v: unknown): void {
    if (!_uc) return;
    _uc[key] = v;
    if (_ucTimer) clearTimeout(_ucTimer);
    _ucTimer = setTimeout(() => { try { if (_ucId) _ucApi?.updateUserConfiguration?.(_ucId, _uc); } catch { /* ignore */ } }, 700);
}
function rowOptions(row: JpxRow): { value: string; label: string }[] {
    if (row.options) return row.options;
    if (row.optionsSource === 'cultures' && _cultures) return _cultures;
    return [];
}
function rowGet(row: JpxRow): unknown {
    const key = row.key || '';
    if (row.store === 'user') {
        try { const fn = (userSettings as unknown as Record<string, (v?: unknown) => unknown>)[key]; if (typeof fn === 'function') return fn(); } catch { /* ignore */ }
        return row.default;
    }
    if (row.store === 'app') {
        try { const v = appSettings.get(key); return (v === '' || v == null) ? row.default : v; } catch { return row.default; }
    }
    if (row.store === 'subApp') {
        try { const cur = (userSettings as unknown as { getSubtitleAppearanceSettings: () => Record<string, unknown> }).getSubtitleAppearanceSettings(); const v = cur[key]; return (v === undefined || v === null || v === '') ? row.default : v; } catch { return row.default; }
    }
    if (row.store === 'userConfig') return ucGet(key, row.default);
    return getPref(key, row.default);
}
function toBool(v: unknown): boolean { return v === true || v === 'true' || v === 1 || v === '1'; }
function rowSet(row: JpxRow, v: unknown): void {
    const key = row.key || '';
    if (row.store === 'user') {
        try { const fn = (userSettings as unknown as Record<string, (v?: unknown) => unknown>)[key]; if (typeof fn === 'function') fn(v); } catch { /* ignore */ }
        return;
    }
    if (row.store === 'app') {
        try { appSettings.set(key, String(v)); } catch { /* ignore */ }
        return;
    }
    if (row.store === 'subApp') {
        try { const us = userSettings as unknown as { getSubtitleAppearanceSettings: () => Record<string, unknown>; setSubtitleAppearanceSettings: (o: Record<string, unknown>) => void }; const cur = us.getSubtitleAppearanceSettings(); cur[key] = v; us.setSubtitleAppearanceSettings(cur); } catch { /* ignore */ }
        return;
    }
    if (row.store === 'userConfig') { ucSet(key, v); return; }
    setPref(key, v);
}
import { promptPin } from './theme/jpxPinPrompt';
import { logoutAccount } from './theme/jpxAccount';
import { promptLibrarySelect } from './theme/jpxLibrarySelect';
import { promptHomeLibraries } from './theme/jpxHomeLibrariesPrompt';
import { promptGenreSelect } from './theme/jpxGenreSelect';
import { promptRecoveryCode } from './theme/jpxRecoveryCodePrompt';
import { promptSeerr } from './theme/jpxSeerrPrompt';
import { promptLibrarySelection } from './theme/jpxLibrarySelection';
import { promptPlayerButtons } from './theme/jpxPlayerButtonsPrompt';
import { hasPin, clearPin, enterKidsMode, exitKidsMode, kidsModeActive, purgeQueryCaches } from './theme/jpxParental';

import './jpxSettingsDrawer.scss';

// Umbry — Moonfin-style Settings drawer. Config-driven (jpxSettingsConfig): renders a stack of
// panels; nav rows push, back pops. Controls: chevron / toggle / value-pill / slider / color /
// static. Moonfin-custom rows persist to jpxPrefs; standard ones route to the real Jellyfin pages.

interface JpxSettingsDrawerProps {
    open: boolean;
    onClose: () => void;
    isAdmin?: boolean;
}

const chev = (icon: string) => <span className='material-icons jpx-settings-chev' aria-hidden='true'>{icon}</span>;

const JpxSettingsDrawer = ({ open, onClose, isAdmin }: JpxSettingsDrawerProps) => {
    const navigate = useNavigate();
    const [ stack, setStack ] = useState<string[]>([ 'root' ]);
    const [ appThemeOpen, setAppThemeOpen ] = useState(false);
    const [ menu, setMenu ] = useState<{ anchor: HTMLElement; row: JpxRow } | null>(null);
    const [ , force ] = useReducer((x: number) => x + 1, 0);
    const [ syncState, setSyncState ] = useState<'idle' | 'syncing' | 'done'>('idle');

    // The Administration row targets the Jellyfin-only dashboard, so gate it to Jellyfin servers
    // (same test the nav pill uses: Jellyfin reports a ProductName; Emby does not; Plex has no such
    // endpoint). Otherwise Emby's admin user sees an "Administration" row that just bounces to home.
    const [ isJellyfinServer, setIsJellyfinServer ] = useState(true);
    // true only inside the Umbry desktop app (preload exposes window.umbry) — gates the Uninstall row
    const isElectron = typeof window !== 'undefined' && !!(window as { umbry?: unknown }).umbry;
    // true inside the Android/Capacitor app (native WebView) — enables the mobile update check
    const isCapacitor = typeof window !== 'undefined' && !!(window as { Capacitor?: unknown }).Capacitor;
    useEffect(() => {
        if (!open) return;
        let addr = '';
        try { addr = (window.ApiClient && window.ApiClient.serverAddress && window.ApiClient.serverAddress()) || ''; } catch (e) { /* ignore */ }
        if (!addr) { setIsJellyfinServer(false); return; }
        fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
            .then(r => r.ok ? r.json() : null)
            .then(info => setIsJellyfinServer(!!(info && info.ProductName && /jellyfin/i.test(String(info.ProductName)))))
            .catch(() => setIsJellyfinServer(false));
    }, [ open ]);

    // Fresh open -> start at root. Re-render when any pref changes.
    useEffect(() => { if (open) setStack([ 'root' ]); }, [ open ]);
    useEffect(() => subscribePrefs(() => force()), []);
    useEffect(() => { if (open) { loadServerData().then(() => force()); } }, [ open ]);

    const panelId = stack[stack.length - 1];
    const panel: JpxPanel = JPX_PANELS[panelId] || JPX_PANELS.root;
    const canBack = stack.length > 1;

    const push = useCallback((id: string) => setStack(s => [ ...s, id ]), []);
    const back = useCallback(() => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)), []);

    // While Kids Mode is on, opening Parental Controls or Administration requires the PIN, so a
    // child can't lift the restrictions. No PIN set (or mode off) -> open freely.
    const enterPanelGuarded = useCallback(async (panel: string) => {
        if (kidsModeActive() && hasPin() && (panel === 'parental' || panel === 'jpxadmin')) {
            const ok = await promptPin({ mode: 'verify', title: 'Enter PIN', subtitle: 'Required to change parental settings' });
            if (!ok) return false;
        }
        return true;
    }, []);

    const handleAction = useCallback(async (action?: string) => {
        switch (action) {
            case 'parental_set_pin':
                await promptPin({ mode: 'set' });
                force();
                break;
            case 'account_recovery_code': {
                // If a PIN is set, require it — stops someone at an unlocked session from generating a
                // recovery code and resetting (and locking out) the owner's password.
                if (hasPin()) {
                    const ok = await promptPin({ mode: 'verify', title: 'Enter PIN', subtitle: 'Required to view your recovery code' });
                    if (!ok) break;
                }
                await promptRecoveryCode();
                break;
            }
            case 'account_sign_out': {
                // If a PIN is set, require it (stops someone signing the owner out at an unlocked session).
                if (hasPin()) {
                    const ok = await promptPin({ mode: 'verify', title: 'Enter PIN', subtitle: 'Required to sign out of your Umbry account' });
                    if (!ok) break;
                }
                logoutAccount();
                window.location.reload(); // account gate re-runs -> shows the sign-in / avatar screen
                break;
            }
            case 'player_buttons':
                await promptPlayerButtons();
                break;
            case 'library_inclusion':
                await promptLibrarySelection();
                force();
                break;
            case 'check_updates': {
                const u = (window as { umbry?: { checkUpdate?: () => Promise<unknown> } }).umbry;
                if (u?.checkUpdate) { try { await u.checkUpdate(); } catch (e) { /* ignore */ } break; }
                // Mobile (Capacitor): compare the injected build version to the APK feed on dl.umbry.org.
                if (isCapacitor) {
                    const cur = String((window as { __UMBRY_VERSION?: string }).__UMBRY_VERSION || '');
                    const cmp = (a: string, b: string) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; };
                    try {
                        const r = await fetch('https://dl.umbry.org/apk-latest.json?t=' + Date.now(), { cache: 'no-store' });
                        const feed = await r.json();
                        const latest = String((feed && feed.version) || '');
                        if (latest && (!cur || cmp(latest, cur) > 0)) {
                            if (window.confirm('Update available: Umbry ' + latest + '.\nDownload and install it now?')) {
                                window.open(String((feed && feed.url) || 'https://umbry.org/#download'), '_blank');
                            }
                        } else {
                            toast('Umbry is up to date' + (cur ? ' (' + cur + ')' : '') + '.');
                        }
                    } catch (e) { toast('Couldn\u2019t check for updates. Try again later.'); }
                }
                break;
            }
            case 'uninstall_umbry': {
                const u = (window as { umbry?: { uninstall?: () => Promise<unknown> } }).umbry;
                if (u?.uninstall) { try { await u.uninstall(); } catch (e) { /* ignore */ } }
                break;
            }
            case 'parental_clear_pin': {
                if (!hasPin()) break;
                const ok = await promptPin({ mode: 'verify', title: 'Enter PIN', subtitle: 'Confirm to remove your PIN' });
                if (ok) { clearPin(); force(); }
                break;
            }
            case 'home_libraries':
                await promptHomeLibraries();
                force();
                break;
            case 'parental_hidden_libs':
                await promptLibrarySelect();
                force();
                break;
            case 'parental_blocked_genres':
                await promptGenreSelect();
                force();
                break;
            case 'parental_enter_kids': {
                if (kidsModeActive()) {
                    // Reached only after passing the PIN gate on this panel, so exit immediately.
                    exitKidsMode();
                    onClose();
                    try { window.location.hash = '#/home'; } catch { /* ignore */ }
                    void purgeQueryCaches().finally(() => { try { window.location.reload(); } catch { /* ignore */ } });
                    break;
                }
                if (!hasPin()) {
                    const set = await promptPin({ mode: 'set', title: 'Set a PIN', subtitle: 'You\u2019ll need it to leave Kids Mode' });
                    if (!set) break;
                }
                enterKidsMode();
                onClose();
                try { window.location.hash = '#/home'; } catch { /* ignore */ }
                void purgeQueryCaches().finally(() => { try { window.location.reload(); } catch { /* ignore */ } });
                break;
            }
            case 'seerr_config':
                onClose();
                setTimeout(() => { void promptSeerr(); }, 200);
                break;
            case 'seerr_open': {
                const { openSeerr, seerrConfigured } = await import('./theme/jpxSeerr');
                if (seerrConfigured()) { openSeerr(); onClose(); } else { onClose(); setTimeout(() => { void promptSeerr(); }, 200); }
                break;
            }
            default: break;
        }
    }, [ onClose ]);

    const onRow = useCallback((row: JpxRow, el: HTMLElement) => {
        switch (row.type) {
            case 'nav':
                if (row.panel) {
                    const panel = row.panel;
                    enterPanelGuarded(panel).then(ok => { if (ok) push(panel); });
                }
                break;
            case 'route':
                if (row.route === 'jpxadmin') {
                    const route = row.route;
                    enterPanelGuarded('jpxadmin').then(ok => { if (ok) { onClose(); navigate('/' + route); } });
                } else {
                    onClose();
                    if (row.route) {
                        let r = row.route;
                        // legacy user-preference pages hang without a userId in the query
                        if (/^mypreferences/.test(r) && !r.includes('?')) {
                            try { const uid = (ServerConnections as { currentApiClient?: () => { getCurrentUserId?: () => string } }).currentApiClient?.()?.getCurrentUserId?.(); if (uid) r += '?userId=' + uid; } catch { /* ignore */ }
                        }
                        navigate('/' + r);
                    }
                }
                break;
            case 'appTheme': setAppThemeOpen(true); break;
            case 'toggle': if (row.key) rowSet(row, !toBool(rowGet(row))); break;
            case 'select': setMenu({ anchor: el, row }); break;
            case 'action': handleAction(row.action); break;
            case 'link': if (row.url) window.open(row.url, '_blank', 'noopener'); onClose(); break;
            default: break;
        }
    }, [ navigate, onClose, push, enterPanelGuarded, handleAction ]);

    const control = (row: JpxRow) => {
        switch (row.type) {
            case 'nav':
            case 'route':
            case 'appTheme':
                return chev('chevron_right');
            case 'link':
                return chev('open_in_new');
            case 'toggle': {
                const on = toBool(rowGet(row));
                return <span className={`jpx-toggle${on ? ' on' : ''}`}><span className='jpx-toggle-knob' /></span>;
            }
            case 'select': {
                const v = String(rowGet(row) ?? '');
                const opt = rowOptions(row).find(o => o.value === v);
                return <span className='jpx-pill'>{opt?.label ?? String(v)}</span>;
            }
            case 'slider': {
                const v = Number(rowGet(row));
                return (
                    <span className='jpx-slider-wrap' onClick={e => e.stopPropagation()}>
                        <Slider
                            size='small'
                            value={Number.isFinite(v) ? v : 0}
                            min={row.min} max={row.max} step={row.step}
                            valueLabelDisplay='auto'
                            onChange={(_e, nv) => rowSet(row, nv as number)}
                        />
                    </span>
                );
            }
            case 'color': {
                const v = String(rowGet(row) ?? row.default ?? '#ffffff');
                return (
                    <label className='jpx-color' style={{ background: v }} onClick={e => e.stopPropagation()}>
                        <input type='color' value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000'} onChange={e => rowSet(row, e.target.value)} />
                    </label>
                );
            }
            case 'action':
                return chev('chevron_right');
            case 'static':
                if (row.title === 'PIN Status') return <span className='jpx-pill jpx-pill-static'>{hasPin() ? 'Set' : 'Not set'}</span>;
                // Version: use the real Umbry version the Player injects (window.__UMBRY_VERSION), not
                // jellyfin-web's internal 12.0. Falls back to the current release for the plain web app.
                if (row.title === 'Version') return <span className='jpx-pill jpx-pill-static'>{((window as { __UMBRY_VERSION?: string }).__UMBRY_VERSION ? 'Umbry ' + (window as { __UMBRY_VERSION?: string }).__UMBRY_VERSION : 'Umbry')}</span>;
                return <span className='jpx-pill jpx-pill-static'>{row.value}</span>;
            default:
                return null;
        }
    };

    const renderRow = (row: JpxRow, i: number) => {
        if (row.type === 'prose') {
            return (
                <div className='jpx-settings-prose' key={row.title + i}>
                    {String(row.body || '').split('\n\n').map((p, pi) => <p key={pi}>{p}</p>)}
                </div>
            );
        }
        const isSlider = row.type === 'slider';
        // The Enter/Exit Kids Mode row flips its label to match the current mode.
        const kidsRow = row.action === 'parental_enter_kids' && kidsModeActive();
        const rowTitle = kidsRow ? 'Exit Kids Mode' : row.title;
        const rowSub = kidsRow ? 'Unlock full content' : row.subtitle;
        return (
            <button
                type='button'
                key={row.title + i}
                className={`jpx-settings-row${isSlider ? ' jpx-settings-row--slider' : ''}`}
                onClick={e => onRow(row, e.currentTarget)}
            >
                {row.icon && (
                    <span className='jpx-settings-ico'>
                        <span className='material-icons' aria-hidden='true'>{row.icon}</span>
                    </span>
                )}
                <span className='jpx-settings-text'>
                    <span className='jpx-settings-row-title'>{rowTitle}</span>
                    {rowSub && <span className='jpx-settings-row-sub'>{rowSub}</span>}
                </span>
                {control(row)}
            </button>
        );
    };

    const doSync = useCallback(() => {
        setSyncState('syncing');
        import('./theme/jpxSync')
            .then(m => Promise.resolve(m.syncNow()))
            .then(() => { setSyncState('done'); setTimeout(() => setSyncState('idle'), 2200); })
            .catch(() => setSyncState('idle'));
    }, []);

    // Sign Out — a Plex server has no real session to end, so exit it (clear the shim + active key)
    // and drop the user at the server picker; a Jellyfin/Emby user signs out normally.
    const doSignOut = useCallback(() => {
        onClose();
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ac = ServerConnections.currentApiClient() as any;
            if (ac && ac.__plex) {
                try { localStorage.removeItem('jpx-active-plex'); } catch { /* ignore */ }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sc = ServerConnections as any;
                try { sc._apiClients = (sc._apiClients || []).filter((c: any) => c !== ac); } catch { /* ignore */ }
                sc.localApiClient = null;
                sc.api = null;
                sc.firstConnection = false;
                try { (window as any).ApiClient = null; } catch { /* ignore */ }
                try { Events.trigger(sc, 'localusersignedout', [ {} ]); } catch { /* ignore */ }
                navigate('/selectserver');
                return;
            }
            // Jellyfin/Emby: sign out ONLY the current server (leave any OTHER servers signed in) — the
            // stock Dashboard.logout() logs out of EVERY connected server, which is why signing out of
            // Jellyfin also killed Emby (and vice versa).
            if (ac && ac.serverId && ac.accessToken && ac.accessToken()) {
                const sid = ac.serverId();
                try { ac.logout(); } catch { /* server-side session end */ }
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const sc = ServerConnections as any;
                    const cp = sc.credentialProvider && sc.credentialProvider();
                    if (cp) {
                        const creds = cp.credentials();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (creds.Servers || []).forEach((s: any) => { if (s.Id === sid) { s.UserId = null; s.AccessToken = null; s.ExchangeToken = null; } });
                        cp.credentials(creds);
                    }
                } catch { /* ignore */ }
                try { const jf = JSON.parse(localStorage.getItem('jpx-active-jf') || 'null'); if (jf && jf.id === sid) localStorage.removeItem('jpx-active-jf'); } catch { /* ignore */ }
                try { (ServerConnections as { localApiClient?: unknown }).localApiClient = null; (window as { ApiClient?: unknown }).ApiClient = null; } catch { /* ignore */ }
                try { Events.trigger(ServerConnections, 'localusersignedout', [ { serverId: sid } ]); } catch { /* ignore */ }
                navigate('/selectserver');
                return;
            }
        } catch { /* ignore */ }
        Dashboard.logout();
    }, [ navigate, onClose ]);

    return (
        <Drawer anchor='right' open={open} onClose={onClose} PaperProps={{ className: 'jpx-settings-paper' }}>
            <div className='jpx-settings-head'>
                {canBack && (
                    <button type='button' className='jpx-settings-close' aria-label='Back' onClick={back}>
                        <span className='material-icons' aria-hidden='true'>arrow_back</span>
                    </button>
                )}
                <span className='jpx-settings-title'>{panel.title}</span>
                <button type='button' className='jpx-settings-close' aria-label='Close settings' onClick={onClose}>
                    <span className='material-icons' aria-hidden='true'>close</span>
                </button>
            </div>

            <div className='jpx-settings-list'>
                {panel.sections.map((sec, si) => {
                    const rows = sec.rows.filter(r => (!r.admin || (isAdmin && isJellyfinServer)) && (!r.electronOnly || isElectron) && (!r.nativeOnly || isElectron || isCapacitor));
                    if (!rows.length) return null; // don't render a header for a section whose rows are all hidden
                    return (
                        <React.Fragment key={si}>
                            {sec.header && <div className='jpx-settings-section-header'>{sec.header}</div>}
                            {rows.map(renderRow)}
                        </React.Fragment>
                    );
                })}
            </div>

            {panelId === 'root' && (
                <div className='jpx-settings-foot'>
                    <button type='button' className='jpx-settings-row jpx-settings-syncnow' onClick={doSync} disabled={syncState === 'syncing'}>
                        <span className='jpx-settings-ico'><span className='material-icons' aria-hidden='true'>{syncState === 'done' ? 'cloud_done' : 'cloud_sync'}</span></span>
                        <span className='jpx-settings-text'>
                            <span className='jpx-settings-row-title'>{syncState === 'syncing' ? 'Syncing…' : syncState === 'done' ? 'Synced' : 'Sync now'}</span>
                            <span className='jpx-settings-row-sub'>Save servers &amp; settings to your account</span>
                        </span>
                    </button>
                    <button type='button' className='jpx-settings-row jpx-settings-signout' onClick={doSignOut}>
                        <span className='jpx-settings-ico'><span className='material-icons' aria-hidden='true'>logout</span></span>
                        <span className='jpx-settings-text'><span className='jpx-settings-row-title'>Sign Out</span></span>
                    </button>
                </div>
            )}

            <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
                {menu?.row && rowOptions(menu.row).map(o => (
                    <MenuItem
                        key={o.value}
                        selected={String(rowGet(menu.row) ?? '') === o.value}
                        onClick={() => { rowSet(menu.row, o.value); setMenu(null); }}
                    >
                        {o.label}
                    </MenuItem>
                ))}
            </Menu>

            <JpxAppThemeDrawer
                open={appThemeOpen}
                onBack={() => setAppThemeOpen(false)}
                onClose={() => { setAppThemeOpen(false); onClose(); }}
            />
        </Drawer>
    );
};

export default JpxSettingsDrawer;
