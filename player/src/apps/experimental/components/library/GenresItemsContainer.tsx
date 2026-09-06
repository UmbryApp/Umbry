import type { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { FC } from 'react';
import { useGetGenres } from 'hooks/useFetchItems';
import NoItemsMessage from 'components/common/NoItemsMessage';
import Loading from 'components/loading/LoadingComponent';
import JpxGenreTile from './JpxGenreTile';
import type { ParentId } from 'types/library';
import './JpxGenres.scss';

interface GenresItemsContainerProps {
    parentId: ParentId;
    collectionType: CollectionType | undefined;
    itemType: BaseItemKind[];
}

// Umbry: Moonfin-style "All Genres" — a grid of genre tiles (representative art + name + count)
// instead of the stock section-with-a-row per genre. Each tile opens that genre's scoped grid.
const GenresItemsContainer: FC<GenresItemsContainerProps> = ({
    parentId,
    itemType
}) => {
    const { isLoading, data: genresResult } = useGetGenres(itemType, parentId);

    if (isLoading) {
        return <Loading />;
    }

    // Filter out junk genres whose name is purely numeric — raw TMDB genre IDs (18=Drama,
    // 35=Comedy, 10752=War, …) that leaked into the library metadata on some items.
    const genres = (genresResult?.Items ?? []).filter((g) => !/^\d+$/.test(String(g.Name || '').trim()));
    if (!genres.length) {
        return <NoItemsMessage message='MessageNoGenresAvailable' />;
    }

    return (
        <div className='jpx-genres-wrap'>
            <div className='jpx-genres-title'>Genres <span className='jpx-genres-count'>{genres.length} Genres</span></div>
            <div className='jpx-genres-grid'>
                {genres.map((genre) => (
                    <JpxGenreTile
                        key={genre.Id}
                        genre={genre}
                        parentId={parentId}
                        itemType={itemType}
                    />
                ))}
            </div>
        </div>
    );
};

export default GenresItemsContainer;
