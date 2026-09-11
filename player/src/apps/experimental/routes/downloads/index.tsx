import React, { type FC, useEffect, useRef } from 'react';

import Page from 'components/Page';
import { renderDownloadsHome } from 'apps/experimental/theme/jpxDownloadsHome';

const Downloads: FC = () => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current) {
            renderDownloadsHome(ref.current);
        }
    }, []);

    return (
        <Page
            id='downloadsPage'
            className='mainAnimatedPage libraryPage'
        >
            <div ref={ref} className='jpx-downloads-home-root' />
        </Page>
    );
};

export default Downloads;
