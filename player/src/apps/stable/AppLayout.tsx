import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import AppBody from 'components/AppBody';
import CustomCss from 'components/CustomCss';
import ThemeCss from 'components/ThemeCss';

// Umbry core theming + runtime, shared with the experimental app. The stable app serves TV and
// any explicitly-selected non-experimental layout; without this it would run vanilla Jellyfin (no
// Umbry styling, sync, ratings, or parental enforcement). Mouse-only shell features (nav pill,
// hover backdrop, card morph) are intentionally left out — TV is remote-driven.
import { initJpxTheme } from '../experimental/theme/jpxTheme';
import { initJpxPrefs } from '../experimental/theme/jpxPrefs';
import { initJpxSync } from '../experimental/theme/jpxSync';
import { initJpxRuntime } from '../experimental/theme/jpxRuntime';
import { initJpxRatings } from '../experimental/theme/jpxRatings';
import { initJpxCloud } from '../experimental/theme/jpxCloud';
import { restorePlexSession } from '../experimental/theme/jpxRestore';
import { installParentalEnforcement } from '../experimental/theme/jpxParentalEnforce';
import { initParental } from '../experimental/theme/jpxParental';
import { initDeepLinkGuard } from '../experimental/theme/jpxDeepLinkGuard';

import '../experimental/theme/jpxThemeTokens.scss';
import '../experimental/theme/jpxDetail.scss';
import '../experimental/AppOverrides.scss';

// Guard so the core boots once. This component only mounts when the stable app is the active layout,
// so it never overlaps with the experimental app's own bootstrap.
let jpxBooted = false;

export default function AppLayout() {
    useEffect(() => {
        if (jpxBooted) return;
        jpxBooted = true;
        (window as unknown as { __jpxRestorePlex?: () => void }).__jpxRestorePlex = restorePlexSession;
        installParentalEnforcement();
        restorePlexSession();
        initJpxTheme();
        initJpxPrefs();
        initJpxSync();
        initJpxCloud();
        initJpxRuntime();
        initJpxRatings();
        initParental();
        initDeepLinkGuard();
    }, []);

    return (
        <>
            <AppBody>
                <Outlet />
            </AppBody>
            <ThemeCss />
            <CustomCss />
        </>
    );
}
