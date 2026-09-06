import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import React from 'react';
import GenresView from '../components/library/GenresView';

// Umbry: dedicated "All Genres" page (Moonfin-style tile grid), opened from the Genres nav button.
// Renders the same GenresView the library Genres tab uses, but unscoped (no parentId) so it
// aggregates genres across every library.
export const Component = () => {
    return (
        <GenresView
            parentId={null}
            collectionType={undefined}
            itemType={[BaseItemKind.Movie, BaseItemKind.Series]}
        />
    );
};
