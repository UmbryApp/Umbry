import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import { loadLibraryTiles } from './libraryTiles';

// Umbry: the "Library Buttons" home section now renders the same Moonfin-style collage
// cards as "My Media" tiles (so it matches regardless of which library section the user has).
export function loadLibraryButtons(elem: HTMLElement, userViews: BaseItemDto[]): Promise<void> {
    return loadLibraryTiles(elem, userViews, { enableOverflow: true });
}
