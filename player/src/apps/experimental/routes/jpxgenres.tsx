import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import React from 'react';
import Page from 'components/Page';
import GenresView from '../components/library/GenresView';

// Umbry: dedicated "All Genres" page (Moonfin-style tile grid), opened from the Genres nav button.
// Renders the same GenresView the library Genres tab uses, but unscoped (no parentId) so it
// aggregates genres across every library. Wrapped in <Page> so it tears down any lingering legacy
// view (e.g. an item-details page) on mount — otherwise the Genres nav button appears to do nothing
// when tapped from a details page.
export const Component = () => {
    return (
        <Page id='jpxGenresPage' className='mainAnimatedPage'>
            <GenresView
                parentId={null}
                collectionType={undefined}
                itemType={[BaseItemKind.Movie, BaseItemKind.Series]}
            />
        </Page>
    );
};
