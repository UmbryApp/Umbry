import type { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import React, { FC } from 'react';

import { useApi } from 'hooks/useApi';
import { useGetItems } from 'hooks/useFetchItems';
import type { ItemDto } from 'types/base/models/item-dto';
import type { ParentId } from 'types/library';

interface JpxGenreTileProps {
    genre: ItemDto;
    parentId: ParentId;
    itemType: BaseItemKind[];
}

// Moonfin-style "All Genres" tile: one card per genre with a representative backdrop, the genre
// name and its item count overlaid, linking to that genre's scoped grid (renderJpxGrouping).
const JpxGenreTile: FC<JpxGenreTileProps> = ({ genre, parentId, itemType }) => {
    const { __legacyApiClient__ } = useApi();
    const { data } = useGetItems({
        sortBy: [ItemSortBy.Random],
        sortOrder: [SortOrder.Ascending],
        includeItemTypes: itemType,
        recursive: true,
        fields: [ItemFields.PrimaryImageAspectRatio],
        imageTypeLimit: 1,
        enableImageTypes: [ImageType.Backdrop, ImageType.Primary],
        limit: 1,
        genreIds: genre.Id ? [genre.Id] : undefined,
        enableTotalRecordCount: true,
        parentId: parentId ?? undefined
    });

    const rep = data?.Items?.[0];
    const count = data?.TotalRecordCount ?? 0;
    const ac = __legacyApiClient__;
    let img: string | undefined;
    if (rep?.Id && ac) {
        if (rep.BackdropImageTags?.length) {
            img = ac.getScaledImageUrl(rep.Id, { type: 'Backdrop', maxWidth: 600, tag: rep.BackdropImageTags[0] });
        } else if (rep.ImageTags?.Primary) {
            img = ac.getScaledImageUrl(rep.Id, { type: 'Primary', maxWidth: 600, tag: rep.ImageTags.Primary });
        }
    }

    return (
        <a
            className='jpx-genre-tile'
            href={'#/details?id=' + genre.Id}
            style={img ? { backgroundImage: `url('${img}')` } : undefined}
        >
            <div className='jpx-genre-tile-scrim' />
            <div className='jpx-genre-tile-meta'>
                <div className='jpx-genre-tile-name'>{genre.Name}</div>
                <div className='jpx-genre-tile-count'>{count} {count === 1 ? 'Item' : 'Items'}</div>
            </div>
        </a>
    );
};

export default JpxGenreTile;
