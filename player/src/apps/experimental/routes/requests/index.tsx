import React, { FunctionComponent, useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import Page from 'components/Page';

/**
 * Umbry "Requests" — a native in-app request/discovery experience backed by
 * the Jellyseerr instance (jellyplex-seerr). Talks to the server through the
 * `/seerr-api` path, which the dev server (and, in production, a Umbry server
 * controller) forwards to Jellyseerr's `/api/v1`. Session is a Jellyseerr
 * `connect.sid` cookie established via a one-time Jellyfin login.
 */

const SEERR = '/seerr-api';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

// Jellyseerr media status codes
const STATUS = {
    1: { label: 'Not Requested', color: 'default' as const },
    2: { label: 'Pending', color: 'warning' as const },
    3: { label: 'Processing', color: 'info' as const },
    4: { label: 'Partially Available', color: 'info' as const },
    5: { label: 'Available', color: 'success' as const }
};

interface SearchResult {
    id: number;
    mediaType: 'movie' | 'tv' | 'person';
    title?: string;
    name?: string;
    releaseDate?: string;
    firstAirDate?: string;
    posterPath?: string;
    overview?: string;
    mediaInfo?: { status?: number };
}

async function seerr(path: string, opts: RequestInit = {}) {
    return fetch(SEERR + path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...opts
    });
}

const titleOf = (r: SearchResult) => r.title || r.name || 'Untitled';
const yearOf = (r: SearchResult) => (r.releaseDate || r.firstAirDate || '').slice(0, 4);

const Requests: FunctionComponent = () => {
    const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [requesting, setRequesting] = useState<number | null>(null);
    const [myRequests, setMyRequests] = useState<any[]>([]);

    const loadRequests = useCallback(async () => {
        const r = await seerr('/request?take=20&sort=added');
        if (r.ok) {
            const d = await r.json();
            setMyRequests(d.results || []);
        }
    }, []);

    // check existing session on mount
    useEffect(() => {
        seerr('/auth/me')
            .then(r => setAuthed(r.ok))
            .catch(() => setAuthed(false));
    }, []);

    useEffect(() => {
        if (authed) loadRequests();
    }, [authed, loadRequests]);

    const login = useCallback(async () => {
        setLoginError('');
        setLoggingIn(true);
        try {
            const r = await seerr('/auth/jellyfin', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            if (r.ok) {
                setAuthed(true);
            } else {
                const e = await r.json().catch(() => ({}));
                setLoginError(e.message || `Sign in failed (${r.status})`);
            }
        } catch (err) {
            setLoginError('Could not reach the request service.');
        } finally {
            setLoggingIn(false);
        }
    }, [username, password]);

    const search = useCallback(async () => {
        if (!query.trim()) return;
        setSearching(true);
        try {
            const r = await seerr('/search?query=' + encodeURIComponent(query) + '&page=1');
            const d = await r.json();
            setResults((d.results || []).filter((x: SearchResult) => x.mediaType === 'movie' || x.mediaType === 'tv'));
        } finally {
            setSearching(false);
        }
    }, [query]);

    const requestItem = useCallback(async (item: SearchResult) => {
        setRequesting(item.id);
        try {
            const r = await seerr('/request', {
                method: 'POST',
                body: JSON.stringify({ mediaType: item.mediaType, mediaId: item.id })
            });
            if (r.ok) {
                setResults(prev => prev.map(p => (
                    p.id === item.id ? { ...p, mediaInfo: { status: 2 } } : p
                )));
                loadRequests();
            }
        } finally {
            setRequesting(null);
        }
    }, [loadRequests]);

    // ---- render ----

    if (authed === null) {
        return (
            <Page id='requestsPage' title='Requests' className='mainAnimatedPage'>
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>
            </Page>
        );
    }

    if (!authed) {
        return (
            <Page id='requestsPage' title='Requests' className='mainAnimatedPage'>
                <Box sx={{ maxWidth: 380, mx: 'auto', mt: 8, px: 2 }}>
                    <Typography variant='h5' sx={{ mb: 1 }}>Connect to Requests</Typography>
                    <Typography variant='body2' sx={{ mb: 3, opacity: 0.7 }}>
                        Sign in with your Jellyfin account to browse and request movies and shows.
                    </Typography>
                    <Stack spacing={2}>
                        <TextField label='Username' value={username} fullWidth
                            onChange={e => setUsername(e.target.value)} />
                        <TextField label='Password' type='password' value={password} fullWidth
                            onChange={e => setPassword(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') login(); }} />
                        {loginError && <Typography color='error' variant='body2'>{loginError}</Typography>}
                        <Button variant='contained' onClick={login} disabled={loggingIn || !username}>
                            {loggingIn ? 'Signing in…' : 'Sign In'}
                        </Button>
                    </Stack>
                </Box>
            </Page>
        );
    }

    return (
        <Page id='requestsPage' title='Requests' className='mainAnimatedPage'>
            <Box sx={{ px: 3, py: 2 }}>
                <Typography variant='h4' sx={{ mb: 2 }}>Requests</Typography>

                <Stack direction='row' spacing={1} sx={{ mb: 3, maxWidth: 640 }}>
                    <TextField placeholder='Search movies & shows to request…' value={query} fullWidth size='small'
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') search(); }} />
                    <Button variant='contained' onClick={search} disabled={searching}>
                        {searching ? '…' : 'Search'}
                    </Button>
                </Stack>

                {results.length > 0 && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 2, mb: 4 }}>
                        {results.map(item => {
                            const st = STATUS[(item.mediaInfo?.status as keyof typeof STATUS)] || STATUS[1];
                            const requested = (item.mediaInfo?.status || 1) >= 2;
                            return (
                                <Card key={item.mediaType + item.id} sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
                                    {item.posterPath
                                        ? <CardMedia component='img' image={TMDB_IMG + item.posterPath}
                                            sx={{ borderRadius: 2, aspectRatio: '2/3', objectFit: 'cover' }} />
                                        : <Box sx={{ borderRadius: 2, aspectRatio: '2/3', bgcolor: 'rgba(255,255,255,0.08)' }} />}
                                    <Typography variant='body2' sx={{ mt: 1, fontWeight: 600 }} noWrap>{titleOf(item)}</Typography>
                                    <Typography variant='caption' sx={{ opacity: 0.6 }}>
                                        {yearOf(item)} · {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                                    </Typography>
                                    <Box sx={{ mt: 0.5 }}>
                                        {requested
                                            ? <Chip size='small' label={st.label} color={st.color} />
                                            : <Button size='small' variant='outlined' fullWidth
                                                disabled={requesting === item.id}
                                                onClick={() => requestItem(item)}>
                                                {requesting === item.id ? '…' : 'Request'}
                                            </Button>}
                                    </Box>
                                </Card>
                            );
                        })}
                    </Box>
                )}

                {myRequests.length > 0 && (
                    <>
                        <Typography variant='h6' sx={{ mb: 1 }}>Your Requests</Typography>
                        <Stack spacing={1} sx={{ maxWidth: 640 }}>
                            {myRequests.map(req => {
                                const st = STATUS[(req.media?.status as keyof typeof STATUS)] || STATUS[1];
                                return (
                                    <Box key={req.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)' }}>
                                        <Typography variant='body2'>
                                            {req.type === 'tv' ? 'Series' : 'Movie'} · TMDB #{req.media?.tmdbId}
                                        </Typography>
                                        <Chip size='small' label={st.label} color={st.color} />
                                    </Box>
                                );
                            })}
                        </Stack>
                    </>
                )}
            </Box>
        </Page>
    );
};

export default Requests;
