import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';

import { getPlexServer, getPlexLibraries, getPlexItems, getPlexCollections, getPlexCollectionItems, getPlexItemFull } from '../theme/jpxPlex';

import './jpxPlex.scss';

type Dict = Record<string, unknown>;
interface Crumb { kind: 'library' | 'collection'; id: string; name: string }

const ticksToRuntime = (ticks: unknown) => {
    const min = Math.round((Number(ticks) || 0) / 600000000);
    return min ? (min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + 'm') : '';
};

// Umbry — native Plex browse + detail + playback. Pulls libraries / collections / items and
// direct-plays Plex media (browser <video>) straight from the Plex Media Server. No routing to Plex.
export const Component = () => {
    const [ sp ] = useSearchParams();
    const serverId = sp.get('server') || '';
    const srv = getPlexServer(serverId);

    const [ libs, setLibs ] = useState<Dict[]>([]);
    const [ stack, setStack ] = useState<Crumb[]>([]);
    const [ items, setItems ] = useState<Dict[]>([]);
    const [ collections, setCollections ] = useState<Dict[]>([]);
    const [ busy, setBusy ] = useState(false);
    const [ detail, setDetail ] = useState<Dict | null>(null);
    const [ playing, setPlaying ] = useState<string | null>(null);

    useEffect(() => { if (srv) getPlexLibraries(srv).then(setLibs).catch(() => { /* ignore */ }); }, [ serverId ]);

    const openLibrary = useCallback((lib: Dict) => {
        if (!srv) return;
        setBusy(true); setItems([]); setCollections([]);
        setStack([ { kind: 'library', id: String(lib.__plexSection), name: String(lib.Name) } ]);
        Promise.all([
            getPlexItems(srv, String(lib.__plexSection), 0, 100).then(r => r.Items).catch(() => [] as Dict[]),
            getPlexCollections(srv, String(lib.__plexSection)).catch(() => [] as Dict[])
        ]).then(([ its, colls ]) => { setItems(its); setCollections(colls); setBusy(false); });
    }, [ srv ]);

    const openCollection = useCallback((coll: Dict) => {
        if (!srv) return;
        setBusy(true); setCollections([]);
        setStack(s => [ ...s, { kind: 'collection', id: String(coll.__plexCollection), name: String(coll.Name) } ]);
        getPlexCollectionItems(srv, String(coll.__plexCollection)).then(r => { setItems(r.Items); setBusy(false); }).catch(() => setBusy(false));
    }, [ srv ]);

    const openDetail = useCallback((item: Dict) => {
        if (!srv) return;
        getPlexItemFull(srv, String(item.__plexRatingKey)).then(full => { if (full) setDetail(full); }).catch(() => { /* ignore */ });
    }, [ srv ]);

    const goRoot = () => { setStack([]); setItems([]); setCollections([]); };

    if (!srv) {
        return <Page id='jpxPlexPage' className='mainAnimatedPage'><div className='jpx-plex-msg'>Plex server not found — add it from the server picker.</div></Page>;
    }

    const iconFor = (type: unknown) => type === 'tvshows' ? 'live_tv' : type === 'music' ? 'library_music' : type === 'homevideos' ? 'photo_library' : 'movie';
    const cast = (detail?.Cast as Array<{ Name: string; Role: string; Img: string | null }>) || [];

    return (
        <Page id='jpxPlexPage' className='mainAnimatedPage' isBackButtonEnabled={false}>
            <div className='jpx-plex'>
                <div className='jpx-plex-head'>
                    <span className='jpx-plex-badge-plex'>PLEX</span>
                    <button type='button' className='jpx-plex-crumb' onClick={() => { setDetail(null); goRoot(); }}>{srv.name}</button>
                    {stack.map((c, i) => (
                        <span key={i} className='jpx-plex-crumbwrap'> <span className='jpx-plex-sep'>›</span> <span className='jpx-plex-crumb jpx-plex-crumb--static'>{c.name}</span></span>
                    ))}
                </div>

                {stack.length === 0 ? (
                    <div className='jpx-plex-grid jpx-plex-libs'>
                        {libs.map(l => (
                            <button type='button' key={String(l.Id)} className='jpx-plex-lib' onClick={() => openLibrary(l)}>
                                <span className='material-icons' aria-hidden='true'>{iconFor(l.CollectionType)}</span>
                                <span>{String(l.Name)}</span>
                            </button>
                        ))}
                        {!libs.length && <div className='jpx-plex-msg'>Loading libraries…</div>}
                    </div>
                ) : (
                    <>
                        {busy && <div className='jpx-plex-msg'>Loading…</div>}
                        {collections.length > 0 && (
                            <div className='jpx-plex-section'>
                                <h2 className='jpx-plex-h2'>Collections</h2>
                                <div className='jpx-plex-grid'>
                                    {collections.map(c => (
                                        <button type='button' key={String(c.Id)} className='jpx-plex-card' onClick={() => openCollection(c)}>
                                            <span className='jpx-plex-poster' style={{ backgroundImage: `url("${String(c.__primaryImageUrl || '')}")` }}>
                                                <span className='jpx-plex-count'>{String(c.ChildCount)}</span>
                                            </span>
                                            <span className='jpx-plex-title'>{String(c.Name)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {!busy && (
                            <div className='jpx-plex-grid'>
                                {items.map(it => (
                                    <button type='button' key={String(it.Id)} className='jpx-plex-card' onClick={() => openDetail(it)}>
                                        <span className='jpx-plex-poster' style={{ backgroundImage: `url("${String(it.__primaryImageUrl || '')}")` }} />
                                        <span className='jpx-plex-title'>{String(it.Name)}</span>
                                        {it.ProductionYear ? <span className='jpx-plex-year'>{String(it.ProductionYear)}</span> : null}
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {detail && (
                <div className='jpx-plex-detail'>
                    <div className='jpx-plex-detail-bd' style={{ backgroundImage: `url("${String(detail.__backdropUrl || detail.__primaryImageUrl || '')}")` }} />
                    <div className='jpx-plex-detail-scrim' />
                    <button type='button' className='jpx-plex-detail-back' onClick={() => setDetail(null)}><span className='material-icons'>arrow_back</span></button>
                    <div className='jpx-plex-detail-body'>
                        <span className='jpx-plex-poster jpx-plex-detail-poster' style={{ backgroundImage: `url("${String(detail.__primaryImageUrl || '')}")` }} />
                        <div className='jpx-plex-detail-info'>
                            <h1>{String(detail.Name)}</h1>
                            <div className='jpx-plex-detail-meta'>
                                {[ detail.ProductionYear && String(detail.ProductionYear), ticksToRuntime(detail.RunTimeTicks), detail.OfficialRating && String(detail.OfficialRating), detail.CommunityRating && ('★ ' + String(detail.CommunityRating)), detail.__videoResolution && (String(detail.__videoResolution) + 'p') ].filter(Boolean).join('  ·  ')}
                            </div>
                            {(detail.Genres as string[])?.length ? <div className='jpx-plex-detail-genres'>{(detail.Genres as string[]).join('  ·  ')}</div> : null}
                            <div className='jpx-plex-detail-actions'>
                                {detail.__streamUrl ? (
                                    <button type='button' className='jpx-plex-play' onClick={() => setPlaying(String(detail.__streamUrl))}>
                                        <span className='material-icons'>play_arrow</span> Play
                                    </button>
                                ) : null}
                                {detail.__streamUrl && !detail.__directPlayable ? <span className='jpx-plex-note'>({String(detail.__container)}/{String(detail.__videoCodec)} — may need transcoding)</span> : null}
                            </div>
                            {detail.Overview ? <p className='jpx-plex-detail-overview'>{String(detail.Overview)}</p> : null}
                            {(detail.Directors as string[])?.length ? <div className='jpx-plex-detail-dir'>Directed by {(detail.Directors as string[]).join(', ')}</div> : null}
                            {cast.length ? (
                                <div className='jpx-plex-cast'>
                                    {cast.map((c, i) => (
                                        <div className='jpx-plex-cast-member' key={i}>
                                            <span className='jpx-plex-cast-img' style={{ backgroundImage: c.Img ? `url("${c.Img}")` : 'none' }} />
                                            <span className='jpx-plex-cast-name'>{c.Name}</span>
                                            {c.Role ? <span className='jpx-plex-cast-role'>{c.Role}</span> : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            {playing && (
                <div className='jpx-plex-player'>
                    <button type='button' className='jpx-plex-player-close' onClick={() => setPlaying(null)}><span className='material-icons'>close</span></button>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video className='jpx-plex-video' src={playing} controls autoPlay />
                </div>
            )}
        </Page>
    );
};

export default Component;
