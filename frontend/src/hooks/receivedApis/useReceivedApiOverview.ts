import { useMemo } from 'react';
import { useQuery, UseQueryResult } from 'react-query';
import { ApiV5Instance } from 'api';
import { isAxiosError } from 'axios';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import {
	ColumnDescriptor,
	QueryRangePayloadV5,
	ScalarData,
} from 'types/api/v5/queryRange';

export interface RuleConfig {
	errorCodes: string;
	warningCodes: string;
	successErrorRate: number;
	warningErrorRate: number;
}

export const DEFAULT_GLOBAL_RULE: RuleConfig = {
	errorCodes: '5xx',
	warningCodes: '4xx',
	successErrorRate: 5,
	warningErrorRate: 10,
};

export interface ReceivedApiRowData {
	key: string;
	endpoint: string;
	serviceName: string;
	httpUrl?: string;
	status: 'success' | 'warning' | 'error';
	lastUsed: string;
	rate: number;
	errorRate: number;
	warningRate: number;
	successRate: number;
	latency: number;
	p99Latency: number;
	totalCount: number;
	errorCount: number;
	warningCount: number;
}

export interface UseReceivedApiOverviewProps {
	start: number; // nanoseconds or milliseconds
	end: number; // nanoseconds or milliseconds
	filterExpression?: string;
	globalRule: RuleConfig;
	apiRules: Record<string, RuleConfig>;
}

export const computeApiStatus = (
	errorRate: number,
	warningRate: number,
	rule: RuleConfig,
): 'success' | 'warning' | 'error' => {
	const successThreshold =
		rule.successErrorRate !== undefined && rule.successErrorRate !== null
			? rule.successErrorRate
			: 5;
	const warningThreshold =
		rule.warningErrorRate !== undefined && rule.warningErrorRate !== null
			? rule.warningErrorRate
			: 10;

	if (errorRate > warningThreshold) {
		return 'error';
	}
	if (errorRate > successThreshold || warningRate > successThreshold) {
		return 'warning';
	}
	return 'success';
};

const BASE_RECEIVED_API_FILTER = "kind_string = 'Server'";

export const buildReceivedApiQueryPayload = (
	startNs: number,
	endNs: number,
	filterExpression?: string,
): QueryRangePayloadV5 => {
	const startMs = startNs > 1e14 ? Math.floor(startNs / 1_000_000) : startNs;
	const endMs = endNs > 1e14 ? Math.floor(endNs / 1_000_000) : endNs;

	const fullFilter = filterExpression?.trim()
		? `(${BASE_RECEIVED_API_FILTER}) AND (${filterExpression.trim()})`
		: BASE_RECEIVED_API_FILTER;

	return {
		schemaVersion: 'v5',
		start: startMs,
		end: endMs,
		requestType: 'scalar',
		compositeQuery: {
			queries: [
				{
					type: 'builder_query',
					spec: {
						name: 'A',
						signal: 'traces',
						stepInterval: 60,
						disabled: false,
						aggregations: [
							{ expression: 'count()', alias: 'total_span' },
							{ expression: 'max(timestamp)', alias: 'lastseen' },
							{ expression: 'p99(duration_nano)', alias: 'p99' },
							{ expression: 'avg(duration_nano)', alias: 'avg' },
							{
								expression: 'countIf(has_error = true OR status_code = 2)',
								alias: 'error_span',
							},
							{
								expression:
									'countIf(response_status_code >= 400 AND response_status_code < 500)',
								alias: 'warning_span',
							},
						],
						filter: {
							expression: fullFilter,
						},
						groupBy: [
							{
								name: 'name',
								fieldDataType: 'string',
								fieldContext: 'span',
							},
							{
								name: 'service.name',
								fieldDataType: 'string',
								fieldContext: 'resource',
							},
						],
						order: [
							{
								key: {
									name: 'count()',
								},
								direction: 'desc',
							},
						],
						limit: 5000,
					},
				},
			],
		},
		formatOptions: {
			formatTableResultForUI: true,
		},
	};
};

export const parseScalarDataToRows = (
	scalarData: ScalarData | undefined,
	timeRangeSeconds: number,
	globalRule: RuleConfig,
	apiRules: Record<string, RuleConfig>,
): ReceivedApiRowData[] => {
	if (!scalarData || !scalarData.columns || !scalarData.data) {
		return [];
	}

	let nameIdx = -1;
	let serviceIdx = -1;
	let httpUrlIdx = -1;
	const aggIdx: Record<string, number> = {};

	scalarData.columns.forEach((col: ColumnDescriptor, idx: number) => {
		const colType = col.columnType || (col as any).type;
		const colName = (col.name || '').toLowerCase();
		if (colType === 'group' || (colType as string) === 'attribute') {
			if (colName === 'name' || colName === 'operation') {
				nameIdx = idx;
			} else if (
				colName === 'service.name' ||
				colName === 'service_name' ||
				colName === 'servicename'
			) {
				serviceIdx = idx;
			} else if (colName === 'http_url' || colName === 'http.url') {
				httpUrlIdx = idx;
			} else if (nameIdx === -1) {
				nameIdx = idx;
			} else if (serviceIdx === -1) {
				serviceIdx = idx;
			} else if (httpUrlIdx === -1) {
				httpUrlIdx = idx;
			}
		} else if (colType === 'aggregation' || !colType) {
			const aggIndex =
				col.aggregationIndex !== undefined ? Number(col.aggregationIndex) : -1;
			if (
				aggIndex === 0 ||
				colName.includes('total_span') ||
				colName === 'count()'
			) {
				aggIdx.total = idx;
			} else if (
				aggIndex === 1 ||
				colName.includes('lastseen') ||
				colName.startsWith('max(')
			) {
				aggIdx.lastseen = idx;
			} else if (aggIndex === 2 || colName.includes('p99')) {
				aggIdx.p99 = idx;
			} else if (aggIndex === 3 || colName.includes('avg')) {
				aggIdx.avg = idx;
			} else if (
				aggIndex === 4 ||
				colName.includes('error_span') ||
				colName.includes('error')
			) {
				aggIdx.error = idx;
			} else if (
				aggIndex === 5 ||
				colName.includes('warning_span') ||
				colName.includes('warning')
			) {
				aggIdx.warning = idx;
			}
		}
	});

	// Positional fallbacks if descriptor names vary
	if (nameIdx === -1 && scalarData.columns.length > 0) {
		nameIdx = 0;
	}
	if (serviceIdx === -1 && scalarData.columns.length > 1) {
		serviceIdx = 1;
	}
	if (aggIdx.total === undefined) {
		aggIdx.total = 2;
	}
	if (aggIdx.lastseen === undefined) {
		aggIdx.lastseen = 3;
	}
	if (aggIdx.p99 === undefined) {
		aggIdx.p99 = 4;
	}
	if (aggIdx.avg === undefined) {
		aggIdx.avg = 5;
	}
	if (aggIdx.error === undefined) {
		aggIdx.error = 6;
	}
	if (aggIdx.warning === undefined) {
		aggIdx.warning = 7;
	}

	const safeDurationSeconds = timeRangeSeconds > 0 ? timeRangeSeconds : 1;

	return scalarData.data.map((row: any[], rowIdx: number) => {
		const endpoint = String(row[nameIdx] || row[0] || 'unknown');
		const serviceName =
			serviceIdx !== -1 && row[serviceIdx]
				? String(row[serviceIdx])
				: row[1]
					? String(row[1])
					: '-';

		const totalCount =
			aggIdx.total !== undefined ? Number(row[aggIdx.total]) || 0 : 0;
		const rawLastSeen =
			aggIdx.lastseen !== undefined ? row[aggIdx.lastseen] : null;
		const rawP99Nano =
			aggIdx.p99 !== undefined ? Number(row[aggIdx.p99]) || 0 : 0;
		const rawAvgNano =
			aggIdx.avg !== undefined ? Number(row[aggIdx.avg]) || 0 : 0;
		const errorCount =
			aggIdx.error !== undefined ? Number(row[aggIdx.error]) || 0 : 0;
		const warningCount =
			aggIdx.warning !== undefined ? Number(row[aggIdx.warning]) || 0 : 0;

		// Latency in ms (duration_nano -> ms)
		const latency = Math.round((rawAvgNano / 1_000_000) * 10) / 10;
		const p99Latency = Math.round((rawP99Nano / 1_000_000) * 10) / 10;

		// Request rate (ops/s)
		const rate = Number((totalCount / safeDurationSeconds).toFixed(2));

		// Error and Warning rates (%)
		const errorRate =
			totalCount > 0 ? Number(((errorCount / totalCount) * 100).toFixed(2)) : 0;
		const warningRate =
			totalCount > 0 ? Number(((warningCount / totalCount) * 100).toFixed(2)) : 0;
		const successRate = Math.max(
			0,
			Number((100 - errorRate - warningRate).toFixed(2)),
		);

		// Format lastUsed
		let lastUsed = '';
		if (rawLastSeen) {
			if (typeof rawLastSeen === 'number') {
				const ms = rawLastSeen > 1e14 ? rawLastSeen / 1_000_000 : rawLastSeen;
				lastUsed = new Date(ms).toISOString();
			} else if (typeof rawLastSeen === 'string') {
				const parsed = Date.parse(rawLastSeen);
				lastUsed = !isNaN(parsed) ? new Date(parsed).toISOString() : rawLastSeen;
			}
		}

		const rawHttpUrl =
			httpUrlIdx !== -1 && row[httpUrlIdx] ? String(row[httpUrlIdx]) : '';
		const httpUrl = rawHttpUrl && rawHttpUrl !== '-' ? rawHttpUrl : undefined;

		// Apply rules (per-API endpoint or httpUrl, or global fallback)
		const activeRule =
			apiRules[endpoint] ||
			(httpUrl ? apiRules[httpUrl] : undefined) ||
			globalRule;
		const status = computeApiStatus(errorRate, warningRate, activeRule);

		return {
			key: `${endpoint}::${serviceName}::${rowIdx}`,
			endpoint,
			serviceName,
			httpUrl,
			status,
			lastUsed,
			rate,
			errorRate,
			warningRate,
			successRate,
			latency,
			p99Latency,
			totalCount,
			errorCount,
			warningCount,
		};
	});
};

export const useReceivedApiOverview = (
	props: UseReceivedApiOverviewProps,
): UseQueryResult<ReceivedApiRowData[], Error> => {
	const { start, end, filterExpression, globalRule, apiRules } = props;

	const timeRangeSeconds = (end - start) / 1_000_000_000;
	const payload = useMemo(
		() => buildReceivedApiQueryPayload(start, end, filterExpression),
		[start, end, filterExpression],
	);

	const queryResult = useQuery<ScalarData | undefined, Error>({
		queryKey: [
			REACT_QUERY_KEY.GET_RECEIVED_APIS,
			start,
			end,
			filterExpression || '',
		],
		queryFn: async ({ signal }) => {
			const response = await ApiV5Instance.post('/query_range', payload, {
				signal,
			});

			const data = response?.data?.data || response?.data;
			const results = data?.results || data?.result || data?.data?.results;
			const scalarResult = Array.isArray(results) ? results[0] : results;
			return scalarResult as ScalarData | undefined;
		},
		staleTime: 60 * 1000,
		cacheTime: 5 * 60 * 1000,
		keepPreviousData: true,
		refetchOnWindowFocus: false,
		retry: (failureCount, error): boolean => {
			if (isAxiosError(error) && error.code === 'ERR_CANCELED') {
				return false;
			}
			return failureCount < 2;
		},
	});

	const formattedData = useMemo(
		() =>
			parseScalarDataToRows(
				queryResult.data,
				timeRangeSeconds,
				globalRule,
				apiRules,
			),
		[queryResult.data, timeRangeSeconds, globalRule, apiRules],
	);

	return {
		...queryResult,
		data: formattedData,
	} as UseQueryResult<ReceivedApiRowData[], Error>;
};
