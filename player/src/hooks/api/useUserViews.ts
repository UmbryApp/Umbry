import type { Api } from '@jellyfin/sdk/lib/api';
import type { UserViewsApiGetUserViewsRequest } from '@jellyfin/sdk/lib/generated-client/api/user-views-api';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from '../useApi';

const fetchUserViews = async (
    api: Api,
    params?: UserViewsApiGetUserViewsRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getUserViewsApi(api)
        .getUserViews(params, options);
    // Umbry: never resolve null/invalid data. A null here white-screens the Home (homesections
    // and libraryMenu read result.Items) and, once cached, poisons every later load until the query
    // cache is purged. Degrade to an empty result instead.
    const data = response?.data;
    try {
        // eslint-disable-next-line no-console
        console.info('[jpx UserViews]', { server: api?.basePath, count: (data && Array.isArray(data.Items)) ? data.Items.length : ('none:' + (data === null ? 'null' : typeof data)) });
    } catch { /* ignore */ }
    return (data && typeof data === 'object') ? data : { Items: [], TotalRecordCount: 0 };
};

export const getUserViewsQuery = (
    api?: Api,
    params?: UserViewsApiGetUserViewsRequest
) => queryOptions({
    queryKey: [ 'User', params?.userId, 'Views', api?.basePath, params ],
    queryFn: ({ signal }) => fetchUserViews(api!, params, { signal }),
    enabled: !!api
});

export const useUserViews = (
    params?: UserViewsApiGetUserViewsRequest
) => {
    const { api, user } = useApi();
    return useQuery(getUserViewsQuery(api, {
        ...params,
        userId: params?.userId || user?.Id
    }));
};
