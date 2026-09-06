import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { appRouter } from 'components/router/appRouter';
import { ServerConnections, ConnectionState } from 'lib/jellyfin-apiclient';
import UserAvatar from 'components/UserAvatar';
import Dashboard from 'utils/dashboard';
import appSettings from 'scripts/settings/appSettings';
import { useApi } from 'hooks/useApi';
import { useUserViews } from 'hooks/api/useUserViews';

import JpxSettingsDrawer from './JpxSettingsDrawer';
import { getPref, setPref, subscribePrefs } from './theme/jpxPrefs';
import { promptPin } from './theme/jpxPinPrompt';
import { openSeerr, seerrConfigured } from './theme/jpxSeerr';
import { promptSeerr } from './theme/jpxSeerrPrompt';
import { hasPin, enterKidsMode, exitKidsMode, kidsModeActive, purgeQueryCaches } from './theme/jpxParental';
import { getPlexServers } from './theme/jpxPlex';
import { makePlexApiClient } from './theme/jpxPlexClient';
import jpxLogo from '../../assets/img/umbry-logo.png';
import jellyfinLogoUrl from '../../assets/img/jellyfin-logo.png';
import embyLogoUrl from '../../assets/img/emby-logo.png';
import plexLogoUrl from '../../assets/img/plex-logo.svg';

import './jpxNavPill.scss';

// Umbry — Moonfin-style nav nested in the logo. Logo + chevron both toggle the pill open.
// Position is driven by the Navigation Style preference and the on-pill position dropdown. There
// are 8 anchor points around the screen; the two side-centres are vertical pills, the other six
// (both top/bottom rows + the top/bottom centres) are horizontal. A screen shift on <body> nudges
// the app content off whichever edge the pill sits on so it never covers anything.
type NavItem = {
    icon: string;
    label: string;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
    active?: boolean;
};

const POSITIONS = [
    'top-left', 'top-center', 'top-right',
    'left-center', 'right-center',
    'bottom-left', 'bottom-center', 'bottom-right'
];
// Vertical (column) pills — only the two side centres. Everything else is a horizontal pill.
const VERTICAL_POSITIONS = [ 'left-center', 'right-center' ];
// Map the old 4-way values onto the new 8-way scheme so saved prefs keep working.
const POS_LEGACY: Record<string, string> = {
    top: 'top-left', bottom: 'bottom-left', left: 'left-center', right: 'right-center'
};
const POS_LABELS: Record<string, string> = {
    'top-left': 'Top Left', 'top-center': 'Top Center', 'top-right': 'Top Right',
    'left-center': 'Left Center', 'right-center': 'Right Center',
    'bottom-left': 'Bottom Left', 'bottom-center': 'Bottom Center', 'bottom-right': 'Bottom Right'
};

const JpxNavPill = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useApi();
    const { data: userViewsData } = useUserViews({ userId: user?.Id });
    const userViews = userViewsData?.Items || [];

    // Position follows the Navigation Style pref; all 8 anchor points are supported (old 4-way
    // values are mapped forward).
    const rawPos = getPref<string>('pref_navbar_position', 'top-left');
    const pos = POSITIONS.includes(rawPos) ? rawPos : (POS_LEGACY[rawPos] || 'top-left');
    const orient = VERTICAL_POSITIONS.includes(pos) ? 'v' : 'h';

    const [ open, setOpen ] = useState(false);
    const [ posAnchor, setPosAnchor ] = useState<HTMLElement | null>(null);
    const [ libAnchor, setLibAnchor ] = useState<HTMLElement | null>(null);
    const [ serverAnchor, setServerAnchor ] = useState<HTMLElement | null>(null);
    const [ serverList, setServerList ] = useState<Array<Record<string, unknown>>>([]);
    const [ serverLogos, setServerLogos ] = useState<Record<string, string>>({});
    // Is the CURRENT server a Jellyfin server? (Jellyfin reports a ProductName; Emby does not; Plex
    // is the __plex shim.) Gates the admin Dashboard button, which is Jellyfin-only.
    const [ isJellyfinServer, setIsJellyfinServer ] = useState(true);
    useEffect(() => {
        try {
            const ac = ServerConnections.currentApiClient() as { __plex?: boolean; serverAddress?: () => string } | undefined;
            if (!ac) return;
            if (ac.__plex) { setIsJellyfinServer(false); return; }
            const addr = ac.serverAddress ? ac.serverAddress() : '';
            if (!addr) return;
            fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
                .then(r => (r.ok ? r.json() : null))
                .then(info => setIsJellyfinServer(!!(info && info.ProductName && /jellyfin/i.test(String(info.ProductName)))))
                .catch(() => { /* keep default */ });
        } catch { /* ignore */ }
    }, []);
    const [ settingsOpen, setSettingsOpen ] = useState(false);
    const [ extraViews, setExtraViews ] = useState<Array<Record<string, unknown>>>([]);
    const isAdmin = Boolean((user as { Policy?: { IsAdministrator?: boolean } } | undefined)?.Policy?.IsAdministrator);

    // Re-render when Navigation prefs change so the pill's buttons show/hide live.
    const [ , force ] = useReducer((x: number) => x + 1, 0);
    useEffect(() => subscribePrefs(() => force()), []);

    // Shift the app content away from the floating pill (opposite edge) — see jpxNavPill.scss.
    useEffect(() => {
        const b = document.body;
        b.setAttribute('data-jpx-nav-pos', pos);
        return () => { b.removeAttribute('data-jpx-nav-pos'); };
    }, [ pos ]);

    // Umbry: Multi-Server Libraries — when enabled, also list library views from every OTHER
    // server the user is signed into (tagged by server name). Fetched when the menu opens.
    useEffect(() => {
        if (!libAnchor || !getPref('enable_multi_server_libraries', false)) { setExtraViews([]); return; }
        const sc = ServerConnections as unknown as {
            currentApiClient?: () => { serverId?: () => string } | undefined;
            getApiClients?: () => Array<{
                serverId?: () => string; isLoggedIn?: () => boolean; getCurrentUserId?: () => string;
                getUserViews?: (o: unknown, u: string) => Promise<{ Items?: Array<Record<string, unknown>> }>;
                serverInfo?: () => { Name?: string };
            }>;
        };
        const curId = sc.currentApiClient?.()?.serverId?.();
        const others = (sc.getApiClients?.() || []).filter(c => c && c.serverId && c.serverId() !== curId && (!c.isLoggedIn || c.isLoggedIn()));
        let cancelled = false;
        Promise.all(others.map(c =>
            Promise.resolve(c.getUserViews?.({}, c.getCurrentUserId?.() || ''))
                .then(r => (r?.Items || []).map(v => ({ ...v, __serverName: c.serverInfo?.().Name || '' })))
                .catch(() => [])
        )).then(arrs => { if (!cancelled) setExtraViews(arrs.flat()); });
        return () => { cancelled = true; };
    }, [ libAnchor ]);

    const toggle = useCallback(() => setOpen(o => !o), []);

    const isFavorites = location.pathname === '/home' && location.search.includes('tab=1');
    const isHome = location.pathname === '/home' && !isFavorites;
    const atRoot = location.pathname === '/home';

    // Back — steps back within the app only; never backs out to the pre-login server screens.
    const goBack = useCallback(() => {
        if (location.pathname === '/home') return;
        void appRouter.back();
    }, [ location.pathname ]);

    // Navigate + collapse the pill back into the logo.
    const go = useCallback((to: string) => {
        navigate(to);
        setOpen(false);
    }, [ navigate ]);

    const playRandom = useCallback(() => {
        setOpen(false);
        const apiClient = ServerConnections.currentApiClient();
        if (!apiClient) return;
        apiClient.getItems(apiClient.getCurrentUserId(), {
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            SortBy: 'Random',
            Limit: 1
        }).then((res: { Items?: unknown[] }) => {
            const item = res.Items && res.Items[0];
            if (item) appRouter.showItem(item);
        }).catch((err: unknown) => console.error('[jpxNav] random failed', err));
    }, []);

    const choosePos = useCallback((p: string) => {
        setPref('pref_navbar_position', p);
        setPosAnchor(null);
    }, []);

    // Switch-server dropdown: list every added server (Jellyfin/Emby + Plex) and jump straight
    // into the chosen one's Home (no full server-select screen).
    const openServerMenu = useCallback((el: HTMLElement) => {
        Promise.resolve(ServerConnections.getAvailableServers()).catch(() => [])
            .then((servers: Array<Record<string, unknown>>) => {
                // Hide the phantom "self" server (this app's own origin, tokenless) from the switcher.
                const originN = String(window.location.origin || '').replace(/\/+$/, '');
                const normA = (a: unknown) => String(a || '').replace(/\/+$/, '');
                const jf = ((servers || []) as Array<Record<string, unknown>>).filter(s => {
                    const self = normA(s.ManualAddress) === originN || normA(s.LocalAddress) === originN || normA(s.RemoteAddress) === originN;
                    return !(self && !s.AccessToken && !s.UserId);
                });
                const plex = getPlexServers().map(s => ({ __plex: true, __plexServer: s, Name: s.name, Id: s.id }));
                setServerList([ ...jf, ...plex ] as Array<Record<string, unknown>>);
                setServerAnchor(el);

                // Per-server logo: Plex → Plex mark; Jellyfin/Emby → Jellyfin by default, swapped to
                // Emby when /System/Info/Public reports no ProductName (same test the picker uses).
                const base: Record<string, string> = {};
                jf.forEach(s => { base[String(s.Id)] = jellyfinLogoUrl; });
                plex.forEach(s => { base[String(s.Id)] = plexLogoUrl; });
                setServerLogos(base);
                jf.forEach(s => {
                    const addr = (s.ManualAddress || s.LocalAddress || s.RemoteAddress || s.address) as string | undefined;
                    if (!addr) return;
                    fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
                        .then(r => (r.ok ? r.json() : null))
                        .then(info => { if (info && !info.ProductName) setServerLogos(prev => ({ ...prev, [String(s.Id)]: embyLogoUrl })); })
                        .catch(() => { /* keep Jellyfin default */ });
                });
            });
    }, []);

    const currentServerId = (() => {
        try { return (ServerConnections.currentApiClient() as { serverId?: () => string } | undefined)?.serverId?.(); } catch { return undefined; }
    })();

    // Load the chosen server's Home with a full reload — the home controller caches its sections
    // (and apiClient) from the previous server, so switching in-place mixes/duplicates rows or keeps
    // the old libraries. A reload re-arms the (now saved) active session and loads ONLY the new
    // server's libraries, in that server's own configured order.
    const goHomeFresh = useCallback(() => {
        try { window.location.hash = '#/home'; } catch { /* ignore */ }
        void purgeQueryCaches().finally(() => { try { window.location.reload(); } catch { /* ignore */ } });
    }, []);

    // Persistent Kids Mode toggle in the nav. Off -> enter (set a PIN first if there isn't one).
    // On -> require the PIN, then leave. Either way reload Home so the content filter applies cleanly.
    const toggleKidsMode = useCallback(async () => {
        if (kidsModeActive()) {
            if (hasPin()) {
                const ok = await promptPin({ mode: 'verify', title: 'Enter PIN', subtitle: 'Unlock full content' });
                if (!ok) return;
            }
            exitKidsMode();
        } else {
            if (!hasPin()) {
                const set = await promptPin({ mode: 'set', title: 'Set a PIN', subtitle: 'Needed to leave Kids Mode later' });
                if (!set) return;
            }
            enterKidsMode();
        }
        goHomeFresh();
    }, [ goHomeFresh ]);

    const chooseServer = useCallback((server: Record<string, unknown>) => {
        setServerAnchor(null);
        setOpen(false);
        if (String(server.Id) === currentServerId) { return; } // already on this server
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sc = ServerConnections as any;
        if (server.__plex) {
            const srv = server.__plexServer as { id: string };
            const client = makePlexApiClient(srv as never);
            try { if (!sc._apiClients.some((a: any) => a.serverId && a.serverId() === srv.id)) sc._apiClients.push(client); } catch { /* ignore */ }
            sc.setLocalApiClient(client);
            sc.firstConnection = true;
            try { localStorage.setItem('jpx-active-plex', srv.id); localStorage.removeItem('jpx-active-jf'); } catch { /* ignore */ }
            goHomeFresh();
            return;
        }
        // Jellyfin/Emby — connect; if already authenticated reload into its Home, else go to its login.
        Promise.resolve(ServerConnections.connectToServer(server, { enableAutoLogin: appSettings.enableAutoLogin() }))
            .then((result: { State?: string; ApiClient?: any }) => {
                if (result && result.State === ConnectionState.SignedIn && result.ApiClient) {
                    const ac = result.ApiClient;
                    try {
                        localStorage.removeItem('jpx-active-plex');
                        localStorage.setItem('jpx-active-jf', JSON.stringify({ id: ac.serverId(), url: ac.serverAddress(), userId: ac.getCurrentUserId(), token: ac.accessToken(), name: (ac.serverInfo && ac.serverInfo().Name) || '' }));
                    } catch { /* ignore */ }
                    Dashboard.onServerChanged(ac.getCurrentUserId(), ac.accessToken(), ac);
                    goHomeFresh();
                } else {
                    navigate('/login?serverid=' + encodeURIComponent(String(server.Id)));
                }
            })
            .catch(() => { navigate('/login?serverid=' + encodeURIComponent(String(server.Id))); });
    }, [ navigate, currentServerId, goHomeFresh ]);

    // Nav buttons are toggleable from Settings › Personalization › Navigation (jpxPrefs).
    const items: NavItem[] = [
        { icon: 'home', label: 'Home', onClick: () => go('/home'), active: isHome },
        { icon: 'search', label: 'Search', onClick: () => go('/search'), active: location.pathname === '/search' },
        { icon: 'movie_filter', label: 'Requests', onClick: () => { if (seerrConfigured()) { openSeerr(); } else { void promptSeerr(); } }, active: false },
        { icon: 'live_tv', label: 'Live TV', onClick: () => go('/jpxlivetv'), active: location.pathname === '/jpxlivetv' },
        ...(getPref('pref_show_shuffle_button', true) ? [{ icon: 'shuffle', label: 'Random', onClick: () => playRandom() }] : []),
        ...(getPref('pref_show_genres_button', true) ? [{ icon: 'theater_comedy', label: 'Genres', onClick: () => go('/jpxgenres'), active: location.pathname === '/jpxgenres' }] : []),
        ...(getPref('pref_show_favorites_button', true) ? [{ icon: 'favorite', label: 'Favorites', onClick: () => go('/home?tab=1'), active: isFavorites }] : []),
        ...(getPref('pref_show_libraries_in_toolbar', true) ? [{ icon: 'video_library', label: 'Libraries', onClick: (e: React.MouseEvent<HTMLElement>) => setLibAnchor(e.currentTarget) }] : []),
        ...(getPref('pref_show_switch_server_button', true) ? [{ icon: 'dns', label: 'Switch Server', onClick: (e: React.MouseEvent<HTMLElement>) => openServerMenu(e.currentTarget) }] : []),
        { icon: kidsModeActive() ? 'lock' : 'lock_open', label: kidsModeActive() ? 'Exit Kids Mode' : 'Kids Mode', onClick: () => { void toggleKidsMode(); } },
        ...(isAdmin && isJellyfinServer ? [{ icon: 'settings', label: 'Dashboard', onClick: () => go('/jpxadmin'), active: location.pathname.startsWith('/jpxadmin') }] : [])
    ];

    return (
        <>
            <nav className={`jpx-nav jpx-nav--${pos} jpx-nav--${orient}${open ? ' open' : ''}`} aria-label='Main navigation'>
                <div className='jpx-nav-pill'>
                    {!atRoot && (
                        <button
                            className='jpx-nav-back'
                            title='Back'
                            aria-label='Back'
                            onClick={goBack}
                        >
                            <span className='material-icons' aria-hidden='true'>arrow_back</span>
                        </button>
                    )}
                    <button
                        className='jpx-nav-logo'
                        title={open ? 'Close menu' : 'Open menu'}
                        aria-expanded={open}
                        onClick={toggle}
                    >
                        <img src={jpxLogo} alt='Umbry' />
                    </button>
                    <div className='jpx-nav-items'>
                        <div className='jpx-nav-items-inner'>
                            {items.map(it => (
                                <button
                                    key={it.label}
                                    className={`jpx-nav-btn${it.active ? ' active' : ''}`}
                                    title={it.label}
                                    aria-label={it.label}
                                    onClick={it.onClick}
                                >
                                    <span className='material-icons' aria-hidden='true'>{it.icon}</span>
                                </button>
                            ))}
                            <button
                                className='jpx-nav-btn jpx-nav-avatar'
                                title='Account &amp; settings'
                                aria-label='Account and settings'
                                onClick={() => { setOpen(false); setSettingsOpen(true); }}
                            >
                                <UserAvatar user={user} size={30} />
                            </button>
                            <button
                                className='jpx-nav-btn jpx-nav-move'
                                title='Nav position'
                                aria-label='Choose navigation position'
                                aria-haspopup='true'
                                onClick={(e: React.MouseEvent<HTMLElement>) => setPosAnchor(e.currentTarget)}
                            >
                                <span className='material-icons' aria-hidden='true'>open_with</span>
                            </button>
                        </div>
                    </div>
                    <button
                        className='jpx-nav-chevron-btn'
                        title={open ? 'Collapse menu' : 'Expand menu'}
                        aria-label={open ? 'Collapse menu' : 'Expand menu'}
                        onClick={toggle}
                    >
                        <span className='jpx-nav-chevron material-icons' aria-hidden='true'>
                            {orient === 'v' ? 'expand_more' : (pos.endsWith('right') ? 'chevron_left' : 'chevron_right')}
                        </span>
                    </button>
                </div>
            </nav>

            <Menu
                anchorEl={libAnchor}
                open={Boolean(libAnchor)}
                onClose={() => setLibAnchor(null)}
            >
                {([ ...userViews, ...extraViews ] as Array<Record<string, unknown>>).map(view => (
                    <MenuItem
                        key={String(view.ServerId || '') + String(view.Id)}
                        onClick={() => { setLibAnchor(null); setOpen(false); appRouter.showItem(view as unknown as Parameters<typeof appRouter.showItem>[0]); }}
                    >
                        {String(view.Name)}{view.__serverName ? ' · ' + String(view.__serverName) : ''}
                    </MenuItem>
                ))}
            </Menu>

            <Menu
                anchorEl={serverAnchor}
                open={Boolean(serverAnchor)}
                onClose={() => setServerAnchor(null)}
            >
                {serverList.map(s => (
                    <MenuItem
                        key={String(s.Id)}
                        selected={String(s.Id) === currentServerId}
                        onClick={() => chooseServer(s)}
                    >
                        <img src={serverLogos[String(s.Id)] || (s.__plex ? plexLogoUrl : jellyfinLogoUrl)} alt='' aria-hidden='true' style={{ width: 22, height: 22, marginRight: 10, objectFit: 'contain', flexShrink: 0 }} />
                        {String(s.Name)}
                        {String(s.Id) === currentServerId ? (
                            <span className='material-icons' aria-label='Currently viewing' title='Currently viewing' style={{ marginLeft: 'auto', paddingLeft: 14, color: 'var(--jpx-t-accent, #9385F5)', fontSize: '1.25rem' }}>check_circle</span>
                        ) : null}
                    </MenuItem>
                ))}
                <MenuItem
                    onClick={() => { setServerAnchor(null); setOpen(false); go('/selectserver'); }}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
                >
                    <span className='material-icons' aria-hidden='true' style={{ marginRight: 10, fontSize: '1.2rem', opacity: 0.85 }}>settings_ethernet</span>
                    Add / Manage Servers…
                </MenuItem>
            </Menu>

            <Menu
                anchorEl={posAnchor}
                open={Boolean(posAnchor)}
                onClose={() => setPosAnchor(null)}
            >
                {POSITIONS.map(p => (
                    <MenuItem
                        key={p}
                        selected={p === pos}
                        onClick={() => choosePos(p)}
                    >
                        {POS_LABELS[p]}
                    </MenuItem>
                ))}
            </Menu>

            <JpxSettingsDrawer
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                isAdmin={isAdmin}
            />
        </>
    );
};

export default JpxNavPill;
