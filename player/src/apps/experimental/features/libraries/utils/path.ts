import * as userSettings from 'scripts/settings/userSettings';

import { LibraryTab } from 'types/libraryTab';
import { LibraryRoutes } from '../constants/libraryRoutes';

/**
 * Utility function to check if a path is a details path.
 */
export const isDetailsPath = (path: string) => (
    path === '/details'
);

/**
 * Utility function to check if a path is a library path.
 */
export const isLibraryPath = (path: string) => (
    LibraryRoutes.some(route => route.path === path)
);

/**
 * Utility function to get the default view index for a specified URL path and library.
 */
export const getDefaultViewIndex = (path: string, libraryId?: string | null) => {
    if (!libraryId) return 0;

    const views = LibraryRoutes.find(route => route.path === path)?.views ?? [];
    const defaultView = userSettings.get('landing-' + libraryId, false);

    // Umbry: Collections-as-default in the Movies library is Plex-only — that's where the
    // user's collections live. On Jellyfin/Emby (non plex_ library ids) open the items grid instead,
    // so a collection-less library never lands on an empty Collections tab.
    const isPlex = String(libraryId).startsWith('plex_');
    let flagIndex = views.find(view => view.isDefault)?.index;
    if (path === '/movies' && !isPlex) {
        flagIndex = views.find(view => view.isDefault && view.view !== LibraryTab.Collections)?.index
            ?? views.find(view => view.view === LibraryTab.Movies)?.index
            ?? 0;
    }
    return views.find(view => view.view === defaultView)?.index
        ?? flagIndex
        ?? 0;
};
