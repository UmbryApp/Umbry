// Umbry account gate — mirrors ConnectionRequired, but for the Umbry account layer that sits IN
// FRONT of any media-server connection. On mount: slide the session forward if one exists (so a
// remembered login never expires); if there's no live session, block on the sign-in screen (which
// shows avatar profiles when any are saved for this server). Then pull the account's servers +
// settings and seed the local stores before rendering. Wired as a layout route in routes.tsx.

import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { accountToken, getSyncMode, refreshSession, logoutAccount, startHeartbeat } from 'apps/experimental/theme/jpxAccount';
import { promptJpxAccount } from 'apps/experimental/theme/jpxAccountPrompt';
import { pullAndHydrate } from 'apps/experimental/theme/jpxCloud';

const JpxAccountRequired = () => {
    const [ ready, setReady ] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const mode = getSyncMode();
            let needPrompt = false;
            if (mode === null) {
                needPrompt = true; // first run — choose a server or local-only
            } else if (mode === 'server') {
                if (accountToken()) {
                    // Slide the session forward so a remembered login never expires. Only a truly
                    // expired token forces a fresh sign-in; offline / an older server (no /auth/refresh)
                    // keep the cached session.
                    const r = await refreshSession();
                    if (r === 'expired') { logoutAccount(); needPrompt = true; }
                } else {
                    needPrompt = true; // no session — prompt (shows avatar profiles if any are saved)
                }
            }
            if (!cancelled && needPrompt) {
                await promptJpxAccount();
            }
            if (cancelled) return;
            // Pull settings only when syncing with a Umbry Server.
            if (getSyncMode() === 'server') {
                try {
                    await pullAndHydrate();
                } catch {
                    // Offline or session expired mid-boot — fall back to whatever is cached locally.
                }
                startHeartbeat(); // keep this device shown in the Server's "Current Connections"
            }
            if (!cancelled) setReady(true);
        })();
        return () => { cancelled = true; };
    }, []);

    if (!ready) return null;
    return <Outlet />;
};

export default JpxAccountRequired;
