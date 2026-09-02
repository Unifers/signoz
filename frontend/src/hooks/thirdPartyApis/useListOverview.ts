import { useQuery, UseQueryResult } from 'react-query';
import listOverview from 'api/thirdPartyApis/listOverview';
import { isAxiosError } from 'axios';
import { MAX_QUERY_RETRIES } from 'constants/reactQuery';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import { SuccessResponseV2 } from 'types/api';
import APIError from 'types/api/error';
import {
	PayloadProps,
	Props as ListOverviewProps,
} from 'types/api/thirdPartyApis/listOverview';

export const useListOverview = (
	props: ListOverviewProps,
): UseQueryResult<SuccessResponseV2<PayloadProps>, APIError> => {
	const {
		start,
		end,
		show_ip: showIp,
		filter,
		group_by_url: groupByUrl,
		globalRule,
		apiRules,
	} = props;
	return useQuery<SuccessResponseV2<PayloadProps>, APIError>({
		queryKey: [
			REACT_QUERY_KEY.GET_DOMAINS_LIST,
			start,
			end,
			showIp,
			filter.expression,
			groupByUrl,
			JSON.stringify(globalRule),
			JSON.stringify(apiRules),
		],
		queryFn: ({ signal }) =>
			listOverview(
				{
					start,
					end,
					show_ip: showIp,
					filter,
					group_by_url: groupByUrl,
					globalRule,
					apiRules,
				},
				signal,
			),
		staleTime: 60 * 1000,
		cacheTime: 5 * 60 * 1000,
		keepPreviousData: true,
		refetchOnWindowFocus: false,
		retry: (failureCount, error): boolean => {
			if (isAxiosError(error) && error.code === 'ERR_CANCELED') {
				return false;
			}
			return failureCount < MAX_QUERY_RETRIES;
		},
	});
};
