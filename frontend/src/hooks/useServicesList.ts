import { useQuery, UseQueryResult } from 'react-query';
import api from 'api';

/**
 * useServicesList fetches the list of services the current user is permitted
 * to access. The backend (`GET /api/v1/services/list`) discovers services
 * from recent telemetry (logs and traces) and filters the response
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
			const response = await api.get<string[] | { data: string[] }>(
				'/services/list',
			);
			const raw = response.data;
			const list = Array.isArray(raw)
				? raw
				: Array.isArray((raw as any)?.data)
					? (raw as any).data
					: [];
			const names = list
				.map((item: any) =>
					typeof item === 'string' ? item : item?.serviceName || '',
				)
				.filter(Boolean);
			return Array.from(new Set(names));
		},
		{
			staleTime: 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);
}
