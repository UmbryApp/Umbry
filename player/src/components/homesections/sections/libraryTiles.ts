import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import { appRouter } from 'components/router/appRouter';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import globalize from 'lib/globalize';

import type { SectionOptions } from './section';

import './jpxLibraryTiles.scss';

// Umbry "My Media" — Moonfin-style landscape library cards: a collage of the library's
// most-recent posters with a reflection, replacing Jellyfin's single-backdrop library tiles.
const POSTERS = 4;

function esc(str: string): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function loadLibraryTiles(
    elem: HTMLElement,
    userViews: BaseItemDto[],
    _options: SectionOptions
): Promise<void> {
    if (!userViews.length) {
        elem.innerHTML = '';
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiClient: any = ServerConnections.currentApiClient();
    if (!apiClient) {
        elem.innerHTML = '';
        return;
    }
    const userId = apiClient.getCurrentUserId();

    const cards = await Promise.all(userViews.map(async view => {
        let imgs = '<div class="jpx-libcard-empty"></div>';
        try {
            const res = await apiClient.getItems(userId, {
                ParentId: view.Id,
                SortBy: 'DateCreated',
                SortOrder: 'Descending',
                Limit: POSTERS,
                Recursive: true,
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary',
                Fields: ''
            });
            const posters = (res.Items || [])
                .filter((i: BaseItemDto) => i.Id && i.ImageTags && i.ImageTags.Primary)
                .slice(0, POSTERS)
                .map((i: BaseItemDto) => apiClient.getScaledImageUrl(i.Id, {
                    type: 'Primary', maxHeight: 300, tag: (i.ImageTags as Record<string, string>).Primary
                }));
            if (posters.length) {
                imgs = posters.map((u: string) => `<img src="${u}" loading="lazy" alt="" />`).join('');
            }
        } catch (err) {
            console.error('[jpxLibTiles] failed for', view.Name, err);
        }
        return '<button class="jpx-libcard" data-id="' + esc(view.Id || '') + '">'
            + '<div class="jpx-libcard-collage">' + imgs + '</div>'
            + '<div class="jpx-libcard-title">' + esc(view.Name || '') + '</div>'
            + '</button>';
    }));

    elem.innerHTML =
        '<h2 class="sectionTitle sectionTitle-cards padded-left">' + globalize.translate('HeaderMyMedia') + '</h2>'
        + '<div class="jpx-libcards-row">' + cards.join('') + '</div>';

    elem.querySelectorAll<HTMLElement>('.jpx-libcard').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.getAttribute('data-id');
            const view = userViews.find(v => v.Id === id);
            if (view) appRouter.showItem(view);
        });
    });
}
