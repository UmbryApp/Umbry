import React, { useEffect } from 'react';
import Box from '@mui/material/Box';
import { Outlet, useLocation } from 'react-router-dom';

import AppBody from 'components/AppBody';
import CustomCss from 'components/CustomCss';
import ThemeCss from 'components/ThemeCss';

import JpxNavPill from './JpxNavPill';
import { initJpxHoverBackdrop } from './jpxHoverBackdrop';
import { initJpxCardMorph } from './jpxCardMorph';
import { initJpxRowMinimize } from './jpxRowMinimize';
import { initJpxLibrarySelection } from './theme/jpxLibrarySelection';
import { initJpxTheme } from './theme/jpxTheme';
import { initJpxPrefs } from './theme/jpxPrefs';
import { initJpxSync } from './theme/jpxSync';
import { initJpxRuntime } from './theme/jpxRuntime';
import { initJpxRatings } from './theme/jpxRatings';
import { LibraryProvider } from './features/libraries/hooks/useLibrary';
import { restorePlexSession } from './theme/jpxRestore';
import { initJpxCloud } from './theme/jpxCloud';
import { installParentalEnforcement } from './theme/jpxParentalEnforce';
import { initParental } from './theme/jpxParental';
import { initDeepLinkGuard } from './theme/jpxDeepLinkGuard';
import { initJpxSpatialNav } from './theme/jpxSpatialNav';
import { initJpxTrakt } from './theme/jpxTrakt';
import { initJpxSimkl } from './theme/jpxSimkl';

// Umbry: register the restore globally so ConnectionRequired can call it WITHOUT importing
// this module (avoids an early module-init cycle), and run it now on load.
(window as unknown as { __jpxRestorePlex?: () => void }).__jpxRestorePlex = restorePlexSession;
restorePlexSession();
installParentalEnforcement();

import './theme/jpxThemeTokens.scss';
import './theme/jpxDetail.scss';
import './AppOverrides.scss';
import './theme/jpxMobileHardening.scss';

// Umbry: Moonfin-style shell — a floating icon nav pill over full-bleed content,
// replacing the stock top toolbar + drawer.
export const Component = () => {
    const location = useLocation();
    // Hide the nav on the fullscreen video player.
    // Hide the nav on the fullscreen video player and the pre-login server/auth screens.
    const AUTH_PATHS = [ '/login', '/selectserver', '/addserver' ];
    const isAuthScreen = AUTH_PATHS.includes(location.pathname) || location.pathname.startsWith('/wizard');
    const showNav = location.pathname !== '/video' && !isAuthScreen;

    // Moonfin-style: hovering a card blurs its backdrop across the page background,
    // and morphs the card in-flow into a landscape backdrop card with info.
    useEffect(() => {
        initJpxTheme();
        initJpxPrefs();
        initJpxRowMinimize();
        initJpxLibrarySelection();
        initJpxSync();
        initJpxCloud();
        initJpxRuntime();
        initJpxRatings();
        initParental();
        initDeepLinkGuard();
        initJpxHoverBackdrop();
        initJpxCardMorph();
        initJpxSpatialNav();
        initJpxTrakt();
        initJpxSimkl();
    }, []);

    return (
        <LibraryProvider>
            <Box
                sx={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%'
                }}
            >
                {showNav && <JpxNavPill />}

                <Box
                    component='main'
                    className='jpx-app-main'
                    sx={{
                        position: 'relative',
                        width: '100%',
                        flexGrow: 1
                    }}
                >
                    <AppBody>
                        <Outlet />
                    </AppBody>
                </Box>
            </Box>
            <ThemeCss />
            <CustomCss />
        </LibraryProvider>
    );
};
