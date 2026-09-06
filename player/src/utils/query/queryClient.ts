import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { del } from 'idb-keyval';

// TODO: Move this file to lib/query

/** HTTP status code for unauthorized requests. */
const HTTP_UNAUTHORIZED = 401;
/** Maximum garbage collection time. Set to 24 hours for persistence. */
const MAX_GC_TIME = 24 * 60 * 60 * 1000;
/** Maximum stale time. Set to 1 minute for query reuse. */
const MAX_STALENESS = 60 * 1000;
/** Maximum number of retries for failed queries. */
const MAX_RETRIES = 2;

// NOTE: queryClient needs to be defined before the QueryCache so that it can be used in the onError callback.
// eslint-disable-next-line prefer-const
export let queryClient: QueryClient;

/** Query cache for handling query errors and side effects. */
const queryCache = new QueryCache({
    onError: (error, { queryKey }) => {
        if (!queryClient) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requestError = error as any;
        const status = requestError?.response?.status || requestError?.status || requestError?.statusCode;
        if (status === HTTP_UNAUTHORIZED) {
            try {
                // If a query fails due to authorization, cancel it and remove it from the cache to prevent showing
                // unauthorized data.
                void queryClient.cancelQueries({ queryKey });
                queryClient.setQueryData(queryKey, null);
            } catch (e) {
                console.warn('[QueryCache] failed to remove unauthorized data', e);
            }
        }
    }
});

queryClient = new QueryClient({
    queryCache,
    defaultOptions: {
        mutations: {
            networkMode: 'always' // network connection is not required if running on localhost
        },
        queries: {
            gcTime: MAX_GC_TIME,
            networkMode: 'always', // network connection is not required if running on localhost
            staleTime: MAX_STALENESS,
            retry: (failureCount, error) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const requestError = error as any;
                const status = requestError?.response?.status || requestError?.status || requestError?.statusCode;
                // Don't retry if unauthorized
                if (status === HTTP_UNAUTHORIZED) return false;
                return failureCount < MAX_RETRIES;
            }
        }
    }
});

/** Create an IndexedDB persister for react-query-persist-client. Uses idb-keyval for simplicity. */
const createIDBPersister = (idbValidKey: IDBValidKey = 'query-cache') => ({
    // Umbry: memory-only cache. Persisting the query cache to IndexedDB let one media server's
    // data (e.g. Plex library IDs) survive a reload and bleed onto another server's Home (400 Bad
    // Request / "previous server's libraries"). Every server switch does a full page reload, so a
    // memory-only cache always starts fresh for the active server. persistClient is a no-op;
    // restoreClient wipes any previously-persisted (poisoned) cache once, then restores nothing.
    persistClient: async (_client: PersistedClient) => { /* no-op: never persist across reloads */ },
    restoreClient: async () => {
        try { await del(idbValidKey); } catch { /* ignore */ }
        return undefined;
    },
    removeClient: async () => {
        try { await del(idbValidKey); } catch { /* ignore */ }
    }
} satisfies Persister);

export const persister = createIDBPersister('jellyfin-query-cache');
