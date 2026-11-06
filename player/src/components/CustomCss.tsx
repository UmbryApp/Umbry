import React, { type FC } from 'react';

import { useUserSettings } from 'hooks/useUserSettings';
import { useBrandingOptions } from 'apps/dashboard/features/branding/api/useBrandingOptions';

const CustomCss: FC = () => {
    const { data: brandingOptions } = useBrandingOptions();
    const { customCss: userCustomCss, disableCustomCss } = useUserSettings();
    // Umbry TV: the server's Branding CSS targets the stock Jellyfin UI (Umbry draws its own) and on a
    // TV it was the single biggest cost — e.g. an endlessly animated 400% html gradient repainting the
    // whole screen every frame, live backdrop blurs, hover transitions. Not loaded on TV; the user's
    // own custom CSS still is.
    const isTv = typeof document !== 'undefined' && document.documentElement.classList.contains('jpx-tv');

    return (
        <>
            {!isTv && !disableCustomCss && brandingOptions?.CustomCss && (
                <style>
                    {brandingOptions.CustomCss}
                </style>
            )}
            {userCustomCss && (
                <style>
                    {userCustomCss}
                </style>
            )}
        </>
    );
};

export default CustomCss;
