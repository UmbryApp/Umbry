import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import classNames from 'classnames';
import React, { type FC, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLibrary } from 'apps/experimental/features/libraries/hooks/useLibrary';
import { getDefaultLibraryViewSettings } from 'apps/experimental/features/libraries/utils/settings';
import Cards from 'components/cardbuilder/Card/Cards';
import { CardShape } from 'components/cardbuilder/utils/shape';
import NoItemsMessage from 'components/common/NoItemsMessage';
import { useNavigate } from 'react-router-dom';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Lists from 'components/listview/List/Lists';
import Loading from 'components/loading/LoadingComponent';
import { ItemAction } from 'constants/itemAction';
import ItemsContainer from 'elements/emby-itemscontainer/ItemsContainer';
import { useApi } from 'hooks/useApi';
import type { CardOptions } from 'types/cardOptions';
import { type LibraryViewSettings, ViewMode } from 'types/library';
import { LibraryTab } from 'types/libraryTab';
import type { ListOptions } from 'types/listOptions';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

import * as userSettings from 'scripts/settings/userSettings';

import AlphabetButton from './AlphabetButton';
import LibraryViewMenu from './LibraryViewMenu';
import SortButton from './SortButton';
import FilterButton from './filter/FilterButton';
import ViewSettingsButton from './ViewSettingsButton';

type Item = NonNullable<ItemDtoQueryResult['Items']>[number];

const ItemsView: FC = () => {
    const {
        id: parentId,
        collectionType,
        content,
        itemsResult,
        viewSettings,
        setViewSettings
    } = useLibrary();
    const viewType = content?.viewType ?? LibraryTab.Movies;
    const libraryViewSettings = viewSettings ?? getDefaultLibraryViewSettings(viewType);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const setLibraryViewSettings = setViewSettings ?? ((action: SetStateAction<LibraryViewSettings>) => { /* no-op */ });
    const { isAlphabetPickerEnabled, noItemsMessage } = content ?? {};

    const { __legacyApiClient__, user } = useApi();
    const isPlexServer = !!(__legacyApiClient__ as unknown as { __plex?: boolean })?.__plex;

    const allItemsQueryKey = useMemo(() => ['User', user?.Id, 'Items'], [user?.Id]);
    const allViewsQueryKey = useMemo(() => [...allItemsQueryKey, parentId, 'ViewByType'], [allItemsQueryKey, parentId]);

    // ---- infinite scroll ----
    // The query fetches ONE page (pageSize) at StartIndex; we accumulate each page into a running
    // list and advance StartIndex when a bottom sentinel scrolls into view. Any change to the list
    // identity (sort / filter / alphabet / view / library) resets the accumulation back to page 0.
    const pageSize = userSettings.libraryPageSize(undefined) || 100;
    const [totalCount, setTotalCount] = useState(0); // persisted so the count doesn't blink to 0 mid-fetch

    const itemsRef = useRef<Item[]>([]);
    const [items, setItems] = useState<Item[]>([]);
    const [reachedEnd, setReachedEnd] = useState(false);
    const loadingMore = useRef(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const listKey = useMemo(() => JSON.stringify({
        p: parentId, v: viewType,
        s: libraryViewSettings.SortBy, o: libraryViewSettings.SortOrder,
        a: libraryViewSettings.Alphabet, f: libraryViewSettings.Filters,
        i: libraryViewSettings.ImageType, m: libraryViewSettings.ViewMode
    }), [
        parentId, viewType,
        libraryViewSettings.SortBy, libraryViewSettings.SortOrder,
        libraryViewSettings.Alphabet, libraryViewSettings.Filters,
        libraryViewSettings.ImageType, libraryViewSettings.ViewMode
    ]);

    // Reset the running list whenever the list identity changes.
    useEffect(() => {
        itemsRef.current = [];
        setItems([]);
        setReachedEnd(false);
        loadingMore.current = false;
        setLibraryViewSettings(prev => ((prev.StartIndex ?? 0) !== 0 ? { ...prev, StartIndex: 0 } : prev));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey]);

    // Append each fetched page to the running list (page 0 replaces; sequential pages append).
    useEffect(() => {
        const page = itemsResult?.data?.Items;
        if (!page || itemsResult?.isPending) return;
        const start = libraryViewSettings.StartIndex ?? 0;
        const total = itemsResult?.data?.TotalRecordCount ?? 0;
        if (start === 0) {
            itemsRef.current = page.slice();
        } else if (start === itemsRef.current.length) {
            itemsRef.current = itemsRef.current.concat(page);
        } else {
            return; // stale / out-of-order page — ignore
        }
        setItems(itemsRef.current);
        if (total > 0) setTotalCount(total);
        setReachedEnd(itemsRef.current.length >= total || page.length === 0);
        loadingMore.current = false;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsResult?.data, itemsResult?.isPending, libraryViewSettings.StartIndex]);

    // Advance StartIndex when the sentinel nears the viewport.
    useEffect(() => {
        if (reachedEnd) return;
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(entries => {
            if (entries[0]?.isIntersecting && !itemsResult?.isFetching && !loadingMore.current && !reachedEnd) {
                loadingMore.current = true;
                setLibraryViewSettings(prev => ({ ...prev, StartIndex: (prev.StartIndex ?? 0) + pageSize }));
            }
        }, { rootMargin: '900px' });
        io.observe(el);
        return () => io.disconnect();
    }, [reachedEnd, itemsResult?.isFetching, pageSize, setLibraryViewSettings, items.length]);

    // Self-heal (Umbry): after a server switch, browser history/bookmarks can point at a library
    // id from the OTHER server — the query then settles empty forever ("Nothing here", refresh
    // doesn't help). If an empty result's parentId isn't among the current server's views, bounce
    // home instead of stranding the user.
    const navigate = useNavigate();
    useEffect(() => {
        if (!parentId) return;
        if (!itemsResult || itemsResult.isPending || itemsResult.isFetching) return;
        const d = itemsResult.data as { TotalRecordCount?: number; Items?: unknown[] } | undefined;
        const settledEmpty = (itemsResult as { isError?: boolean }).isError
            || (d ? (d.TotalRecordCount ?? d.Items?.length ?? 0) === 0 : false);
        if (!settledEmpty) return;
        let live = true;
        (async () => {
            try {
                const ac = ServerConnections.currentApiClient();
                if (!ac) return;
                const v = await ac.getUserViews({}, ac.getCurrentUserId());
                if (live && !(v.Items || []).some((x: { Id?: string }) => x.Id === parentId)) {
                    navigate('/home', { replace: true });
                }
            } catch { /* ignore */ }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsResult?.data, itemsResult?.isPending, itemsResult?.isFetching, parentId]);

    const countText = items.length > 0
        ? `${items.length.toLocaleString()} of ${(totalCount || items.length).toLocaleString()}`
        : '';

    const getListOptions = useCallback(() => {
        const listOptions: ListOptions = {
            items,
            context: collectionType
        };

        if (viewType === LibraryTab.Songs) {
            listOptions.showParentTitle = true;
            listOptions.action = ItemAction.PlayAllFromHere;
            listOptions.smallIcon = true;
            listOptions.showArtist = true;
            listOptions.addToListButton = true;
        } else if (viewType === LibraryTab.Albums) {
            listOptions.sortBy = libraryViewSettings.SortBy;
            listOptions.addToListButton = true;
        } else if (viewType === LibraryTab.Episodes) {
            listOptions.showParentTitle = true;
        }

        return listOptions;
    }, [items, collectionType, viewType, libraryViewSettings.SortBy]);

    const getCardOptions = useCallback(() => {
        let shape;
        let preferThumb;
        let preferDisc;
        let preferLogo;

        if (libraryViewSettings.ImageType === ImageType.Banner) {
            shape = CardShape.Banner;
        } else if (libraryViewSettings.ImageType === ImageType.Disc) {
            shape = CardShape.Square;
            preferDisc = true;
        } else if (libraryViewSettings.ImageType === ImageType.Logo) {
            shape = CardShape.Backdrop;
            preferLogo = true;
        } else if (libraryViewSettings.ImageType === ImageType.Thumb) {
            shape = CardShape.Backdrop;
            preferThumb = true;
        } else {
            shape = CardShape.Auto;
        }

        const cardOptions: CardOptions = {
            shape,
            showTitle: libraryViewSettings.ShowTitle,
            showYear: libraryViewSettings.ShowYear,
            cardLayout: libraryViewSettings.CardLayout,
            centerText: true,
            context: collectionType,
            coverImage: true,
            preferThumb,
            preferDisc,
            preferLogo,
            overlayText: !libraryViewSettings.ShowTitle,
            imageType: libraryViewSettings.ImageType,
            queryKey: allViewsQueryKey,
            serverId: __legacyApiClient__?.serverId()
        };

        if (
            viewType === LibraryTab.Songs
            || viewType === LibraryTab.Albums
            || viewType === LibraryTab.Episodes
        ) {
            cardOptions.showParentTitle = libraryViewSettings.ShowTitle;
            cardOptions.overlayPlayButton = true;
        } else if (viewType === LibraryTab.Artists || viewType === LibraryTab.Authors) {
            cardOptions.lines = 1;
            cardOptions.showYear = false;
            cardOptions.overlayPlayButton = true;
        } else if (viewType === LibraryTab.Channels) {
            cardOptions.shape = CardShape.Square;
            cardOptions.showDetailsMenu = true;
            cardOptions.showCurrentProgram = true;
            cardOptions.showCurrentProgramTime = true;
        } else if (viewType === LibraryTab.SeriesTimers) {
            cardOptions.shape = CardShape.Backdrop;
            cardOptions.showSeriesTimerTime = true;
            cardOptions.showSeriesTimerChannel = true;
            cardOptions.overlayMoreButton = true;
            cardOptions.lines = 3;
        } else if (viewType === LibraryTab.Movies) {
            cardOptions.overlayPlayButton = true;
        } else if (viewType === LibraryTab.Series || viewType === LibraryTab.Studios) {
            cardOptions.overlayMoreButton = true;
        }

        return cardOptions;
    }, [
        __legacyApiClient__,
        libraryViewSettings.ShowTitle,
        libraryViewSettings.ImageType,
        libraryViewSettings.ShowYear,
        libraryViewSettings.CardLayout,
        collectionType,
        allViewsQueryKey,
        viewType
    ]);

    const getItems = useCallback(() => {
        if (!items.length) {
            return <NoItemsMessage message={noItemsMessage ?? 'MessageNoItemsAvailable'} />;
        }

        if (libraryViewSettings.ViewMode === ViewMode.ListView) {
            return (
                <Lists
                    items={items}
                    listOptions={getListOptions()}
                />
            );
        }
        return (
            <Cards
                items={items}
                cardOptions={getCardOptions()}
            />
        );
    }, [
        libraryViewSettings.ViewMode,
        items,
        getListOptions,
        getCardOptions,
        noItemsMessage
    ]);

    const hasSortName = libraryViewSettings.SortBy !== ItemSortBy.Random;

    const itemsContainerClass = classNames(
        'padded-left padded-right',
        libraryViewSettings.ViewMode === ViewMode.ListView ?
            'vertical-list' :
            'vertical-wrap'
    );

    const isInitialLoading = items.length === 0 && (!itemsResult || itemsResult.isPending);

    return (
        <Box className='padded-bottom-page'>
            <Box className='padded-left padded-right jpx-lib-viewswitch' sx={{ mt: 6, mb: 0.5, display: 'flex', alignItems: 'center' }}>
                <LibraryViewMenu />
                {countText && (
                    <Box component='span' sx={{ ml: 2, opacity: 0.68, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                        {countText}
                    </Box>
                )}
                <Box className='jpx-lib-actions' sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                    {isAlphabetPickerEnabled && hasSortName && (
                        <AlphabetButton
                            libraryViewSettings={libraryViewSettings}
                            setLibraryViewSettings={setLibraryViewSettings}
                        />
                    )}
                    {!isPlexServer && (
                        <FilterButton
                            parentId={parentId}
                            itemType={content?.itemType ?? []}
                            viewType={viewType}
                            hasFilters={false}
                            libraryViewSettings={libraryViewSettings}
                            setLibraryViewSettings={setLibraryViewSettings}
                        />
                    )}
                    <SortButton
                        viewType={viewType}
                        libraryViewSettings={libraryViewSettings}
                        setLibraryViewSettings={setLibraryViewSettings}
                    />
                    <ViewSettingsButton
                        viewType={viewType}
                        libraryViewSettings={libraryViewSettings}
                        setLibraryViewSettings={setLibraryViewSettings}
                    />
                </Box>
            </Box>

            {isInitialLoading ? (
                <Loading />
            ) : (
                <>
                    <ItemsContainer
                        className={itemsContainerClass}
                        parentId={parentId}
                        reloadItems={itemsResult?.refetch}
                        queryKey={allItemsQueryKey}
                    >
                        {getItems()}
                    </ItemsContainer>
                    {!reachedEnd && items.length > 0 && (
                        <Box
                            ref={sentinelRef}
                            sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 56, py: 3 }}
                        >
                            {itemsResult?.isFetching && <CircularProgress size={30} />}
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
};

export default ItemsView;
