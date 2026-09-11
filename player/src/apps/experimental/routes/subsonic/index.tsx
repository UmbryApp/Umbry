import React, { type FC, useEffect, useRef } from 'react';

import Page from 'components/Page';
import { renderSubsonicHome } from 'apps/experimental/theme/jpxSubsonicHome';

const Subsonic: FC = () => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current) {
            renderSubsonicHome(ref.current);
        }
    }, []);

    return (
        <Page
            id='subsonicPage'
            className='mainAnimatedPage libraryPage'
        >
            <div ref={ref} className='jpx-subsonic-home-root' />
        </Page>
    );
};

export default Subsonic;
