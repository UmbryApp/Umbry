import React, { type FC, useCallback, useEffect } from 'react';
import { useSearchItems } from '../api/useSearchItems';
import globalize from 'lib/globalize';
import Loading from 'components/loading/LoadingComponent';
import SearchResultsRow from './SearchResultsRow';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { Section } from '../types';
import { Link } from 'react-router-dom';
import './jpxSearch.scss';

interface SearchResultsProps {
    parentId?: string;
    collectionType?: CollectionType;
    query?: string;
}

/*
 * React component to display search result rows for global search and library view search.
 * Umbry: adds a Moonfin-style category-count chip row (All: N / Movies: N / ...) that jumps
 * to the matching section on tap.
 */
const SearchResults: FC<SearchResultsProps> = ({
    parentId,
    collectionType,
    query
}) => {
    const { data, isPending } = useSearchItems(parentId, collectionType, query?.trim());

    const onChip = useCallback((title: string) => {
        const el = document.querySelector(`[data-jpx-section="${CSS.escape(title)}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    // Moonfin puts the EPISODE title first and "SxE - Series" second; cardBuilder emits the
    // reverse ("Series" / "SxE - Episode"). Recompose the two text lines after the cards build.
    useEffect(() => {
        if (!data?.length) return;
        const sec = document.querySelector('[data-jpx-section="Episodes"]');
        if (!sec) return;
        sec.querySelectorAll('.card').forEach(card => {
            const el = card as HTMLElement & { __jpxSwapped?: boolean };
            if (el.__jpxSwapped) return;
            const lines = el.querySelectorAll('.cardText');
            if (lines.length < 2) return;
            const series = (lines[0].textContent || '').trim();
            const sub = (lines[1].textContent || '').trim();
            const m = /^(S\d+:E\d+)\s*-\s*(.+)$/.exec(sub);
            if (!m) return;
            lines[0].textContent = m[2];
            lines[1].textContent = `${m[1]} - ${series}`;
            el.__jpxSwapped = true;
        });
    }, [data]);

    if (isPending) return <Loading />;

    if (!data?.length) {
        return (
            <div className='noItemsMessage centerMessage'>
                {globalize.translate('SearchResultsEmpty', query)}
                {collectionType && (
                    <div>
                        <Link
                            className='emby-button'
                            to={`/search?query=${encodeURIComponent(query || '')}`}
                        >{globalize.translate('RetryWithGlobalSearch')}</Link>
                    </div>
                )}
            </div>
        );
    }

    const total = data.reduce((n, s) => n + (s.items?.length || 0), 0);

    const renderSection = (section: Section, index: number) => {
        const title = globalize.translate(section.title);
        return (
            <div key={`${section.title}-${index}`} className='jpx-search-section' data-jpx-section={title}>
                <SearchResultsRow
                    title={title}
                    items={section.items}
                    cardOptions={{
                        shape: CardShape.AutoOverflow,
                        scalable: true,
                        showTitle: true,
                        overlayText: false,
                        centerText: true,
                        allowBottomPadding: false,
                        ...section.cardOptions
                    }}
                />
            </div>
        );
    };

    return (
        <div className={'searchResults padded-top padded-bottom-page'}>
            <div className='jpx-search-chips'>
                <span className='jpx-search-chip jpx-search-chip-all'>All: {total}</span>
                {data.map((section, i) => {
                    const title = globalize.translate(section.title);
                    return (
                        <button
                            key={`chip-${section.title}-${i}`}
                            type='button'
                            className='jpx-search-chip'
                            onClick={() => onChip(title)}
                        >{title}: {section.items?.length || 0}</button>
                    );
                })}
            </div>
            {data.map((section, index) => renderSection(section, index))}
        </div>
    );
};

export default SearchResults;
