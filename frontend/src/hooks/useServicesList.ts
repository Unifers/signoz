import { useQuery, UseQueryResult } from 'react-query';
import { ApiV2Instance } from 'api';
import type { ServicesList } from 'types/api/metrics/getService';

/**
 * useServicesList fetches the list of services the current user is permitted
 * to access. The backend (`GET /api/v1/services/list`) filters the response
 * by the caller's project permissions, so for users with a restricted custom
 * role this list excludes any service they were not granted.
 *
 * The result is intentionally a plain string[] of service names because every
 * consumer only needs to know "is X in my allowed set?" — keeping the API
 * minimal avoids leaking response shape decisions into UI code.
 */
export function useServicesList(): UseQueryResult<string[], Error> {
	return useQuery<string[], Error>(
		['getServicesList'],
		async () => {
			const end = Date.now() * 1000000;
			const start = end - 7 * 24 * 60 * 60 * 1000 * 1000000; // 7 days in nanoseconds
			const response = await ApiV2Instance.post('/services', {
				start: String(start),
				end: String(end),
				tags: [],
			});
			const data = (response.data?.data as ServicesList[]) || [];
			const names = data.map((item) => item.serviceName).filter(Boolean);
			return Array.from(new Set(names));
		},
		{
			staleTime: 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);
}
