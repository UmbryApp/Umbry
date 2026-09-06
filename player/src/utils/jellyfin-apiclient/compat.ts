import { Api, Jellyfin } from '@jellyfin/sdk';
import { ApiClient } from 'jellyfin-apiclient';

import { safeDecodeURIComponent } from 'utils/url';
import { plexSdkAdapter } from 'apps/experimental/theme/jpxPlexClient';
import { kidsModeActive, filterListResult, filterViewsResult } from 'apps/experimental/theme/jpxParental';
import { filterViewsResult as filterInclusionViews, serverKeyForClient as inclusionServerKey } from 'apps/experimental/theme/jpxLibraryInclusion';

/**
 * Server-compatibility layer for the universal client. Jellyfin and Emby share most of the
 * API, but modern Jellyfin (10.10+) moved several user-scoped endpoints to user-agnostic
 * paths (/UserViews, /UserItems/Resume, /Items/Latest) that Emby never had. Emby only serves
 * the older /Users/{userId}/... forms — which Jellyfin still honors too — so we always rewrite
 * to the common /Users/{userId}/... path. Add rows here as more divergences surface.
 *
 * Each rule maps a matched request path to its user-scoped equivalent. userId is pulled from
 * the request's query string (the SDK bakes params into the URL via setSearchParams ->
 * toPathString) or, as a fallback, from config.params.
 *
 * Attached as an axios request interceptor to every SDK Api instance (created only via toApi).
 */
const USER_SCOPED_REWRITES: Array<{ test: RegExp; to: (userId: string) => string }> = [
    { test: /(^|\/)UserViews$/, to: (u) => `Users/${u}/Views` },
    { test: /(^|\/)UserItems\/Resume$/, to: (u) => `Users/${u}/Items/Resume` },
    { test: /(^|\/)Items\/Latest$/, to: (u) => `Users/${u}/Items/Latest` }
];

const applyServerCompat = (api: Api): void => {
    api.axiosInstance.interceptors.request.use((config) => {
        const url = config.url || '';
        const qIndex = url.indexOf('?');
        const path = qIndex === -1 ? url : url.slice(0, qIndex);

        const rule = USER_SCOPED_REWRITES.find((r) => r.test.test(path));
        if (rule) {
            const search = new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
            const params = config.params as Record<string, unknown> | undefined;
            const userId = search.get('userId') || (params?.userId as string | undefined);
            if (userId) {
                search.delete('userId');
                const newPath = path.replace(rule.test, (_m, p1) => (p1 || '') + rule.to(encodeURIComponent(userId)));
                const qs = search.toString();
                config.url = qs ? `${newPath}?${qs}` : newPath;
                if (params?.userId) {
                    const rest = { ...params };
                    delete rest.userId;
                    config.params = rest;
                }
            }
        }

        return config;
    });
};

/**
 * Umbry Kids Mode enforcement for the SDK Api path.
 *
 * The experimental UI (home rows, library grids, search) fetches through the SDK Api's axios
 * instance (hooks/useFetchItems), which never touches the legacy ApiClient.prototype patch in
 * jpxParentalEnforce. So we mirror the filtering here, at toApi — the single place every SDK Api
 * is created.
 *
 * Response-only and deliberately conservative, after an earlier version broke playback and blanked
 * pages:
 *   - It NEVER rewrites requests. Rewriting URLs to inject fields corrupted some requests (a Plex/
 *     Emby playback call failed with a server error). Rating, block-unrated and hidden-library rules
 *     all work from OfficialRating, which the server returns by default; genre/tag blocking on the
 *     SDK path is best-effort and handled elsewhere.
 *   - It only touches GET responses (never playback POSTs) and is fully synchronous — no awaited
 *     network work in the interceptor (the async auto-hide sampling could hang and blank the page).
 *   - It fails open on anything unexpected. Off (Kids Mode inactive) = pure pass-through.
 */
const isViewsPath = (path: string): boolean => /(^|\/)(UserViews|Views)$/i.test(path) || /\/Users\/[^/]+\/Views$/i.test(path);

const applyParentalEnforcement = (api: Api): void => {
    api.axiosInstance.interceptors.response.use((response) => {
        try {
            if (!kidsModeActive()) return response;
            const method = ((response.config && response.config.method) || 'get').toLowerCase();
            if (method !== 'get') return response; // never touch playback / other non-GET calls
            const data = response.data;
            const url = (response.config && response.config.url) || '';
            const path = url.indexOf('?') === -1 ? url : url.slice(0, url.indexOf('?'));
            if (data && typeof data === 'object' && Array.isArray(data.Items)) {
                response.data = isViewsPath(path) ? filterViewsResult(data) : filterListResult(data);
            } else if (Array.isArray(data)) {
                response.data = filterListResult(data);
            }
        } catch { /* fail open */ }
        return response;
    });
};

/**
 * Returns an SDK Api instance using the same parameters as the provided ApiClient.
 * @param {ApiClient} apiClient The (legacy) ApiClient.
 * @returns {Api} An equivalent SDK Api instance.
 */
/**
 * Umbry: per-server library inclusion (allowlist). Same conservative, response-only shape as the
 * parental enforcement above, but keyed to a fixed server (computed once from the source ApiClient)
 * and independent of Kids Mode. Deselected libraries are stripped from every getUserViews response
 * on the SDK path (Home rows via homesections + nav Libraries menu via libraryMenu, JF/Emby + Plex).
 */
const applyLibraryInclusion = (api: Api, serverKey: string): void => {
    api.axiosInstance.interceptors.response.use((response) => {
        try {
            const method = ((response.config && response.config.method) || 'get').toLowerCase();
            if (method !== 'get') return response;
            const data = response.data;
            const url = (response.config && response.config.url) || '';
            const path = url.indexOf('?') === -1 ? url : url.slice(0, url.indexOf('?'));
            if (isViewsPath(path) && data && typeof data === 'object' && Array.isArray(data.Items)) {
                response.data = filterInclusionViews(data, serverKey);
            }
        } catch { /* fail open */ }
        return response;
    });
};

export const toApi = (apiClient: ApiClient): Api => {
    const api = (new Jellyfin({
        // The SDK encodes these values when creating the authorization header,
        // so we need to decode them here to avoid double encoding.
        clientInfo: {
            name: safeDecodeURIComponent(apiClient.appName()),
            version: safeDecodeURIComponent(apiClient.appVersion())
        },
        deviceInfo: {
            name: safeDecodeURIComponent(apiClient.deviceName()),
            id: safeDecodeURIComponent(apiClient.deviceId())
        }
    })).createApi(
        apiClient.serverAddress(),
        apiClient.accessToken()
    );

    applyServerCompat(api);
    applyParentalEnforcement(api);
    applyLibraryInclusion(api, inclusionServerKey(apiClient));

    // Umbry: if this client is a Plex shim, answer all SDK calls from Plex.
    const plexClient = apiClient as unknown as { __plex?: boolean; __plexServer?: unknown };
    if (plexClient && plexClient.__plex && plexClient.__plexServer) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api.axiosInstance.defaults as any).adapter = plexSdkAdapter(plexClient.__plexServer as any);
        // Plex has no Jellyfin realtime socket — make subscribe a no-op so the SDK never opens a
        // failing WebSocket to <plex-host>/socket. Returns a cleanup fn, matching the real API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api as any).subscribe = () => () => { /* no realtime for Plex */ };
    }

    return api;
};
