import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { useApi } from 'hooks/useApi';

import './jpxAdmin.scss';

// Umbry — Moonfin-style Server Administration dashboard. A self-contained page (route
// /jpxadmin) that reads real Jellyfin admin data. The left rail links to Jellyfin's existing
// /dashboard/* pages (stock for now); the Dashboard home here is the reskinned view.

interface AdminApi {
    getCurrentUserId(): string;
    getPublicSystemInfo(): Promise<Record<string, unknown>>;
    getSessions(): Promise<unknown[]>;
    getItemCounts(userId: string): Promise<Record<string, number>>;
    getUsers(): Promise<unknown[]>;
    getUrl(path: string, params?: Record<string, unknown>): string;
    getJSON(url: string): Promise<{ Items?: Array<{ Severity?: string }> }>;
    restartServer(): Promise<unknown>;
    shutdownServer(): Promise<unknown>;
    ajax(opts: { type: string; url: string }): Promise<unknown>;
}

interface RailItem { icon: string; label: string; route: string }
interface RailGroup { header: string; items: RailItem[] }

const RAIL: RailGroup[] = [
    { header: 'Server', items: [
        { icon: 'dashboard', label: 'Dashboard', route: '/jpxadmin' },
        { icon: 'insights', label: 'Analytics', route: '/dashboard/activity' },
        { icon: 'settings', label: 'Settings', route: '/dashboard/settings' },
        { icon: 'brush', label: 'Branding', route: '/dashboard/branding' },
        { icon: 'people', label: 'Users', route: '/dashboard/users' },
        { icon: 'video_library', label: 'Libraries', route: '/dashboard/libraries' },
        { icon: 'grid_view', label: 'Display', route: '/dashboard/settings' },
        { icon: 'description', label: 'Metadata', route: '/dashboard/libraries' }
    ] },
    { header: 'Playback', items: [
        { icon: 'swap_horiz', label: 'Transcoding', route: '/dashboard/playback/transcoding' },
        { icon: 'stream', label: 'Streaming', route: '/dashboard/playback/streaming' },
        { icon: 'view_comfy', label: 'Trickplay', route: '/dashboard/playback/trickplay' }
    ] },
    { header: 'Devices', items: [
        { icon: 'devices', label: 'Devices', route: '/dashboard/devices' },
        { icon: 'history', label: 'Activity', route: '/dashboard/activity' }
    ] },
    { header: 'Advanced', items: [
        { icon: 'language', label: 'Networking', route: '/dashboard/networking' },
        { icon: 'vpn_key', label: 'API Keys', route: '/dashboard/keys' },
        { icon: 'article', label: 'Logs', route: '/dashboard/logs' },
        { icon: 'schedule', label: 'Scheduled Tasks', route: '/dashboard/tasks' }
    ] },
    { header: 'Plugins', items: [
        { icon: 'extension', label: 'Plugins', route: '/dashboard/plugins' },
        { icon: 'source', label: 'Repositories', route: '/dashboard/plugins/repositories' }
    ] },
    { header: 'Live TV', items: [
        { icon: 'live_tv', label: 'Live TV', route: '/dashboard/livetv' }
    ] }
];

const MEDIA = [
    { key: 'MovieCount', label: 'Movies', icon: 'movie_creation' },
    { key: 'SeriesCount', label: 'Series', icon: 'tv' },
    { key: 'EpisodeCount', label: 'Episodes', icon: 'live_tv' },
    { key: 'AlbumCount', label: 'Albums', icon: 'album' },
    { key: 'SongCount', label: 'Songs', icon: 'music_note' },
    { key: 'BookCount', label: 'Books', icon: 'menu_book' },
    { key: 'BoxSetCount', label: 'Collections', icon: 'collections_bookmark' }
];

interface AdminData {
    serverName: string;
    version: string;
    os: string;
    sessions: number;
    users: number;
    errors: number;
    warnings: number;
    counts: Record<string, number>;
}

const num = (n: number | undefined) => (n ?? 0).toLocaleString();

export const Component = () => {
    const navigate = useNavigate();
    const { user } = useApi();
    const isAdmin = Boolean((user as { Policy?: { IsAdministrator?: boolean } } | undefined)?.Policy?.IsAdministrator);
    // Umbry hard admin guard: only administrators may load the backend dashboard.
    // Non-admins (and anyone who reaches /jpxadmin directly by URL) are bounced to Home.
    useEffect(() => {
        if (user && !isAdmin) navigate('/home', { replace: true });
    }, [ user, isAdmin, navigate ]);
    // The admin dashboard reads Jellyfin admin APIs; Emby/Plex differ (their pages 404), so bounce.
    useEffect(() => {
        try {
            const ac = ServerConnections.currentApiClient() as unknown as { __plex?: boolean; serverAddress?: () => string };
            if (!ac) return;
            if (ac.__plex) { navigate('/home', { replace: true }); return; }
            const addr = ac.serverAddress ? ac.serverAddress() : '';
            if (!addr) return;
            fetch(String(addr).replace(/\/+$/, '') + '/System/Info/Public', { cache: 'no-cache' })
                .then(r => (r.ok ? r.json() : null))
                .then(info => { if (!info || !info.ProductName || !/jellyfin/i.test(String(info.ProductName))) navigate('/home', { replace: true }); })
                .catch(() => { /* ignore */ });
        } catch { /* ignore */ }
    }, [ navigate ]);
    const [ data, setData ] = useState<AdminData | null>(null);
    const [ loading, setLoading ] = useState(true);
    const [ failed, setFailed ] = useState(false);

    const load = useCallback(() => {
        const api = ServerConnections.currentApiClient() as unknown as AdminApi;
        if (!api || typeof (api as unknown as { getSessions?: unknown }).getSessions !== 'function') { setFailed(true); setLoading(false); return; }
        setLoading(true);
        setFailed(false);
        const userId = api.getCurrentUserId();
        Promise.all([
            api.getPublicSystemInfo().catch(() => ({} as Record<string, unknown>)),
            api.getSessions().catch(() => [] as unknown[]),
            api.getItemCounts(userId).catch(() => ({} as Record<string, number>)),
            api.getUsers().catch(() => [] as unknown[]),
            api.getJSON(api.getUrl('System/ActivityLog/Entries', { StartIndex: 0, Limit: 200 })).catch(() => ({ Items: [] }))
        ]).then(([info, sessions, counts, users, activity]) => {
            const items = activity.Items || [];
            setData({
                serverName: String(info.ServerName || 'Umbry'),
                version: String(info.Version || ''),
                os: String(info.OperatingSystem || 'Linux/Unix'),
                sessions: sessions.length,
                users: users.length,
                errors: items.filter(e => e.Severity === 'Error' || e.Severity === 'Critical').length,
                warnings: items.filter(e => e.Severity === 'Warning').length,
                counts
            });
            setLoading(false);
        }).catch(() => { setFailed(true); setLoading(false); });
    }, []);

    useEffect(() => { load(); }, [ load ]);

    const action = useCallback((kind: 'restart' | 'shutdown' | 'scan') => {
        const api = ServerConnections.currentApiClient() as unknown as AdminApi;
        if (!api) return;
        if (kind === 'scan') {
            api.ajax({ type: 'POST', url: api.getUrl('Library/Refresh') });
            return;
        }
        const msg = kind === 'restart' ? 'Restart the server now?' : 'Shut down the server now?';
        // eslint-disable-next-line no-alert
        if (!window.confirm(msg)) return;
        if (kind === 'restart') api.restartServer();
        else api.shutdownServer();
    }, []);

    // Render nothing until we know the user; non-admins get bounced by the effect above.
    if (!user || !isAdmin) return null;

    return (
        <div className='jpx-admin'>
            <nav className='jpx-admin-rail'>
                {RAIL.map(group => (
                    <div className='jpx-admin-rail-group' key={group.header}>
                        <div className='jpx-admin-rail-header'>{group.header}</div>
                        {group.items.map(it => (
                            <button
                                type='button'
                                key={it.label}
                                className={`jpx-admin-rail-item${it.route === '/jpxadmin' ? ' active' : ''}`}
                                onClick={() => navigate(it.route)}
                            >
                                <span className='material-icons' aria-hidden='true'>{it.icon}</span>
                                <span>{it.label}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </nav>

            <main className='jpx-admin-main'>
                <div className='jpx-admin-titlebar'>
                    <button type='button' className='jpx-admin-back' onClick={() => navigate('/home')}>
                        <span className='material-icons' aria-hidden='true'>arrow_back</span>
                        <span>Home</span>
                    </button>
                    <span className='material-icons jpx-admin-title-ico' aria-hidden='true'>dashboard</span>
                    <h1>Dashboard</h1>
                    <button type='button' className='jpx-admin-close' aria-label='Close' onClick={() => navigate('/home')}>
                        <span className='material-icons' aria-hidden='true'>close</span>
                    </button>
                </div>

                {loading && <div className='jpx-admin-msg'>Loading dashboard…</div>}
                {failed && (
                    <div className='jpx-admin-msg'>
                        Failed to load dashboard.
                        <button type='button' className='jpx-admin-btn' onClick={load}>Retry</button>
                    </div>
                )}

                {data && !loading && (
                    <>
                        <div className='jpx-admin-kpis'>
                            <div className='jpx-admin-kpi'><span className='material-icons'>people_alt</span><b>{num(data.sessions)}</b><span>Sessions</span></div>
                            <div className={`jpx-admin-kpi${data.errors ? ' bad' : ''}`}><span className='material-icons'>error_outline</span><b>{num(data.errors)}</b><span>Errors</span></div>
                            <div className={`jpx-admin-kpi${data.warnings ? ' warn' : ''}`}><span className='material-icons'>warning_amber</span><b>{num(data.warnings)}</b><span>Warnings</span></div>
                            <div className='jpx-admin-kpi'><span className='material-icons'>group</span><b>{num(data.users)}</b><span>Users</span></div>
                        </div>

                        <div className='jpx-admin-section-title'>Server Info</div>
                        <div className='jpx-admin-card jpx-admin-info'>
                            <div><span>Name</span><b>{data.serverName}</b></div>
                            <div><span>Version</span><b>{data.version}</b></div>
                            <div><span>OS</span><b>{data.os}</b></div>
                        </div>

                        <div className='jpx-admin-section-title'>Server Actions</div>
                        <div className='jpx-admin-actions'>
                            <button type='button' className='jpx-admin-btn' onClick={() => action('restart')}><span className='material-icons'>restart_alt</span>Restart Server</button>
                            <button type='button' className='jpx-admin-btn' onClick={() => action('shutdown')}><span className='material-icons'>power_settings_new</span>Shutdown Server</button>
                            <button type='button' className='jpx-admin-btn' onClick={() => action('scan')}><span className='material-icons'>refresh</span>Scan Libraries</button>
                        </div>

                        <div className='jpx-admin-section-title'>Media Overview</div>
                        <div className='jpx-admin-media'>
                            {MEDIA.map(m => (
                                <div className='jpx-admin-mediacard' key={m.key}>
                                    <span className='jpx-admin-media-label'>{m.label}</span>
                                    <span className='jpx-admin-media-count'>{num(data.counts[m.key])}</span>
                                    <span className='material-icons jpx-admin-media-ico' aria-hidden='true'>{m.icon}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
};
