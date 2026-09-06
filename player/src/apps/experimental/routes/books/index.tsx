import React, { type FC, useEffect, useRef } from 'react';

import Page from 'components/Page';
import { renderBooksHome } from 'apps/experimental/theme/jpxBooksHome';

const Books: FC = () => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current) {
            renderBooksHome(ref.current);
        }
    }, []);

    return (
        <Page
            id='booksPage'
            className='mainAnimatedPage libraryPage'
        >
            <div ref={ref} className='jpx-books-home-root' />
        </Page>
    );
};

export default Books;
