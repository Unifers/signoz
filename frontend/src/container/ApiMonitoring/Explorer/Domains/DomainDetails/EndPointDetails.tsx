import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from 'react-query';
import { useLocation } from 'react-router-dom';
import { Card, Spin } from 'antd';
import { ENTITY_VERSION_V4, ENTITY_VERSION_V5 } from 'constants/app';
import { initialQueriesMap } from 'constants/queryBuilder';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import { useApiMonitoringParams } from 'container/ApiMonitoring/queryParams';
import {
	END_POINT_DETAILS_QUERY_KEYS_ARRAY,
	convertFiltersWithUrlHandling,
	extractPortAndEndpoint,
	getDomainNameFilterExpression,
	getEndPointDetailsQueryPayload,
	getFormattedEndPointMetricsData,
	getLatencyOverTimeWidgetData,
	getRateOverTimeWidgetData,
} from 'container/ApiMonitoring/utils';
import DateTimeSelectionV2 from 'container/TopNav/DateTimeSelectionV2';
import GetMinMax from 'lib/getMinMax';
import QueryBuilderSearchV2 from 'container/QueryBuilder/filters/QueryBuilderSearchV2/QueryBuilderSearchV2';
import {
	CustomTimeType,
	Time,
} from 'container/TopNav/DateTimeSelectionV2/types';
import { GetMetricQueryRange } from 'lib/dashboard/getQueryResults';
import { SuccessResponse } from 'types/api';
import { MetricRangePayloadProps } from 'types/api/metrics/getQueryRange';
import { DataTypes } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { IBuilderQuery } from 'types/api/queryBuilder/queryBuilderData';
import { EQueryType } from 'types/common/dashboard';
import { DataSource, ReduceOperators } from 'types/common/queryBuilder';

import DependentServices from './components/DependentServices';
import EndPointMetrics from './components/EndPointMetrics';
import EndPointsDropDown from './components/EndPointsDropDown';
import MetricOverTimeGraph from './components/MetricOverTimeGraph';
import StatusCodeBarCharts from './components/StatusCodeBarCharts';
import StatusCodeTable from './components/StatusCodeTable';
import { SPAN_ATTRIBUTES } from './constants';

const httpUrlKey = {
	dataType: DataTypes.String,
	key: SPAN_ATTRIBUTES.HTTP_URL,
	type: 'tag',
};

const stripQueryParams = (url: string): string => {
	if (!url) {
		return '';
	}
	return url.split('?')[0];
};

function EndPointDetails({
	domainName,
	endPointName,
	setSelectedEndPointName,
	initialFilters,
	timeRange,
	handleTimeChange,
}: {
	domainName: string;
	endPointName: string;
	setSelectedEndPointName: (value: string) => void;
	initialFilters: IBuilderQuery['filters'];
	timeRange: {
		startTime: number;
		endTime: number;
	};
	handleTimeChange: (
		interval: Time | CustomTimeType,
		dateTimeRange?: [number, number],
	) => void;
}): JSX.Element {
	const { startTime: minTime, endTime: maxTime } = timeRange;
	const [params, setParams] = useApiMonitoringParams();

	const currentQuery = initialQueriesMap[DataSource.TRACES];

	// Local state for filters, combining endpoint filter and search filters
	const [filters, setFilters] = useState<IBuilderQuery['filters']>(() => {
		// Initialize filters based on the initial endPointName prop
		const initialItems = params.endPointDetailsLocalFilters
			? [...(params.endPointDetailsLocalFilters?.items || [])]
			: [...(initialFilters?.items || [])];
		if (endPointName) {
			const cleanEndPointName = stripQueryParams(endPointName);
			initialItems.push({
				id: '92b8a1c1',
				key: httpUrlKey,
				op: 'LIKE',
				value: `${cleanEndPointName}%`,
			});
		}
		return { op: 'AND', items: initialItems };
	});

	// Effect to synchronize local filters when the endPointName prop changes (e.g., from dropdown)
	useEffect(() => {
		setFilters((currentFilters) => {
			const existingHttpUrlFilter = currentFilters?.items?.find(
				(item) => item.key?.key === httpUrlKey.key,
			);
			const existingHttpUrlValue = (existingHttpUrlFilter?.value as string) || '';

			const cleanEndPointName = stripQueryParams(endPointName);
			const cleanExistingValue = existingHttpUrlValue.endsWith('%')
				? existingHttpUrlValue.slice(0, -1)
				: existingHttpUrlValue;

			// Only update filters if the prop value is different from what's already in filters
			if (cleanEndPointName === cleanExistingValue) {
				return currentFilters; // No change needed, prevents loop
			}

			// Rebuild filters: Keep non-http_url filters and add/update http_url filter based on prop
			const otherFilters = currentFilters?.items?.filter(
				(item) => item.key?.key !== httpUrlKey.key,
			);
			const newItems = [...(otherFilters || [])];
			if (endPointName) {
				newItems.push({
					id: '92b8a1c1',
					key: httpUrlKey,
					op: 'LIKE',
					value: `${cleanEndPointName}%`,
				});
			}
			return { op: 'AND', items: newItems };
		});
	}, [endPointName]);

	// Separate effect to update params when filters change
	useEffect(() => {
		const filtersWithoutHttpUrl = {
			op: 'AND',
			items:
				filters?.items?.filter((item) => item.key?.key !== httpUrlKey.key) || [],
		};
		setParams({ endPointDetailsLocalFilters: filtersWithoutHttpUrl });
	}, [filters, setParams]);

	// Handler for changes from the QueryBuilderSearchV2 component
	const handleFilterChange = useCallback(
		(newFilters: IBuilderQuery['filters']): void => {
			// 1. Update local filters state immediately
			setFilters(newFilters);
			// Filter out http_url filter before saving to params
			const filteredNewFilters = {
				op: 'AND',
				items:
					newFilters?.items?.filter((item) => item.key?.key !== httpUrlKey.key) ||
					[],
			};
			setParams({ endPointDetailsLocalFilters: filteredNewFilters });

			// 2. Derive the endpoint name from the *new* filters state
			const httpUrlFilter = newFilters?.items?.find(
				(item) => item.key?.key === httpUrlKey.key,
			);
			const derivedEndPointValue = (httpUrlFilter?.value as string) || '';
			const derivedEndPointName = derivedEndPointValue.endsWith('%')
				? derivedEndPointValue.slice(0, -1)
				: derivedEndPointValue;

			// 3. If the derived endpoint name is different from the current prop,
			//    it means the search change modified the effective endpoint.
			//    Notify the parent component.
			if (derivedEndPointName !== endPointName) {
				setSelectedEndPointName(derivedEndPointName);
			}
		},
		[endPointName, setSelectedEndPointName, setParams], // Dependencies for the callback
	);

	const updatedCurrentQuery = useMemo(
		() => ({
			...currentQuery,
			builder: {
				...currentQuery.builder,
				queryData: [
					{
						...currentQuery.builder.queryData[0],
						dataSource: DataSource.TRACES,
						filters, // Use the local filters state
					},
				],
			},
		}),
		[filters, currentQuery],
	);

	const query = updatedCurrentQuery?.builder?.queryData[0] || null;

	const isServicesFilterApplied = useMemo(
		() => filters?.items?.some((item) => item.key?.key === 'service.name'),
		[filters],
	);

	const endPointDetailsQueryPayload = useMemo(
		() => getEndPointDetailsQueryPayload(domainName, minTime, maxTime, filters),
		[domainName, filters, minTime, maxTime],
	);

	const V5_QUERIES = [
		REACT_QUERY_KEY.GET_ENDPOINT_STATUS_CODE_DATA,
		REACT_QUERY_KEY.GET_ENDPOINT_STATUS_CODE_BAR_CHARTS_DATA,
		REACT_QUERY_KEY.GET_ENDPOINT_STATUS_CODE_LATENCY_BAR_CHARTS_DATA,
		REACT_QUERY_KEY.GET_ENDPOINT_METRICS_DATA,
		REACT_QUERY_KEY.GET_ENDPOINT_DEPENDENT_SERVICES_DATA,
		REACT_QUERY_KEY.GET_ENDPOINT_DROPDOWN_DATA,
	] as const;

	const endPointDetailsDataQueries = useQueries(
		endPointDetailsQueryPayload.map((payload, index) => {
			const queryKey = END_POINT_DETAILS_QUERY_KEYS_ARRAY[index];
			const version = (V5_QUERIES as readonly string[]).includes(queryKey)
				? ENTITY_VERSION_V5
				: ENTITY_VERSION_V4;
			return {
				queryKey: [
					END_POINT_DETAILS_QUERY_KEYS_ARRAY[index],
					payload,
					...(filters?.items?.length ? filters.items : []), // Include filters.items in queryKey for better caching
					version,
				],
				queryFn: (): Promise<SuccessResponse<MetricRangePayloadProps>> =>
					GetMetricQueryRange(payload, version),
				enabled: !!payload,
			};
		}),
	);

	const [
		endPointMetricsDataQuery,
		endPointStatusCodeDataQuery,
		endPointDropDownDataQuery,
		endPointDependentServicesDataQuery,
		endPointStatusCodeBarChartsDataQuery,
		endPointStatusCodeLatencyBarChartsDataQuery,
	] = useMemo(
		() => [
			endPointDetailsDataQueries[0],
			endPointDetailsDataQueries[1],
			endPointDetailsDataQueries[2],
			endPointDetailsDataQueries[3],
			endPointDetailsDataQueries[4],
			endPointDetailsDataQueries[5],
		],
		[endPointDetailsDataQueries],
	);
	const metricsData = useMemo(() => {
		if (
			endPointMetricsDataQuery.isLoading ||
			endPointMetricsDataQuery.isRefetching ||
			endPointMetricsDataQuery.isError ||
			!endPointMetricsDataQuery.data
		) {
			return null;
		}

		return getFormattedEndPointMetricsData(
			endPointMetricsDataQuery.data?.payload?.data?.result[0]?.table?.rows as any,
		);
	}, [
		endPointMetricsDataQuery.data,
		endPointMetricsDataQuery.isLoading,
		endPointMetricsDataQuery.isRefetching,
		endPointMetricsDataQuery.isError,
	]);
	const { endpoint, port } = useMemo(
		() => extractPortAndEndpoint(endPointName), // Derive display info from the prop
		[endPointName],
	);

	const { search } = useLocation();

	const isExpanded = useMemo(() => {
		const searchParams = new URLSearchParams(search);
		return searchParams.get('expandedWidgetId') === 'latency-over-time-widget';
	}, [search]);

	const modalSelectedTimeRange = useMemo(() => {
		if (params.modalSelectedTimeRange) {
			return params.modalSelectedTimeRange;
		}
		return timeRange; // fallback to drawer's time range
	}, [params.modalSelectedTimeRange, timeRange]);

	const modalQueryPayload = useMemo(() => {
		const filterExpr = convertFiltersWithUrlHandling(
			filters || { items: [], op: 'AND' },
			getDomainNameFilterExpression(domainName),
		);

		return {
			selectedTime: 'GLOBAL_TIME',
			graphType: 'table',
			query: {
				queryType: EQueryType.QUERY_BUILDER,
				builder: {
					queryData: [
						{
							aggregations: [{ expression: 'p50(duration_nano)' }],
							aggregateOperator: 'p50',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'A',
							filter: { expression: filterExpr },
							queryName: 'A',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'p50',
						},
						{
							aggregations: [{ expression: 'p90(duration_nano)' }],
							aggregateOperator: 'p90',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'B',
							filter: { expression: filterExpr },
							queryName: 'B',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'p90',
						},
						{
							aggregations: [{ expression: 'p95(duration_nano)' }],
							aggregateOperator: 'p95',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'C',
							filter: { expression: filterExpr },
							queryName: 'C',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'p95',
						},
						{
							aggregations: [{ expression: 'p99(duration_nano)' }],
							aggregateOperator: 'p99',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'D',
							filter: { expression: filterExpr },
							queryName: 'D',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'p99',
						},
						{
							aggregations: [{ expression: 'avg(duration_nano)' }],
							aggregateOperator: 'avg',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'E',
							filter: { expression: filterExpr },
							queryName: 'E',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'avg',
						},
						{
							aggregations: [{ expression: 'max(duration_nano)' }],
							aggregateOperator: 'max',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'F',
							filter: { expression: filterExpr },
							queryName: 'F',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'max',
						},
						{
							aggregations: [{ expression: 'min(duration_nano)' }],
							aggregateOperator: 'min',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'G',
							filter: { expression: filterExpr },
							queryName: 'G',
							reduceTo: ReduceOperators.AVG,
							timeAggregation: 'min',
						},
					],
				},
			},
			start: modalSelectedTimeRange.startTime,
			end: modalSelectedTimeRange.endTime,
		} as any;
	}, [domainName, filters, modalSelectedTimeRange]);

	const modalMetricsQuery = useQuery(
		[
			REACT_QUERY_KEY.GET_ENDPOINT_METRICS_DATA,
			'modal',
			modalQueryPayload,
			...(filters?.items?.length ? filters.items : []),
			ENTITY_VERSION_V5,
		],
		() => GetMetricQueryRange(modalQueryPayload, ENTITY_VERSION_V5),
		{
			enabled: isExpanded && !!modalQueryPayload,
			keepPreviousData: true,
		},
	);

	const modalMetricsData = useMemo(() => {
		if (
			modalMetricsQuery.isLoading ||
			modalMetricsQuery.isRefetching ||
			modalMetricsQuery.isError ||
			!modalMetricsQuery.data
		) {
			return null;
		}

		const rows =
			modalMetricsQuery.data?.payload?.data?.result?.[0]?.table?.rows ||
			modalMetricsQuery.data?.payload?.data?.newResult?.data?.result?.[0]?.table
				?.rows;
		if (!rows || rows.length === 0) {
			return null;
		}

		const rowData = rows[0]?.data || {};

		const getMs = (val: unknown): string => {
			if (val === undefined || val === null || val === '' || val === 'n/a') {
				return '-';
			}
			return String(Math.round(Number(val) / 1000000));
		};

		return {
			p50Latency: getMs(rowData.A),
			p90Latency: getMs(rowData.B),
			p95Latency: getMs(rowData.C),
			p99Latency: getMs(rowData.D),
			avgLatency: getMs(rowData.E),
			maxLatency: getMs(rowData.F),
			minLatency: getMs(rowData.G),
		};
	}, [
		modalMetricsQuery.data,
		modalMetricsQuery.isLoading,
		modalMetricsQuery.isRefetching,
		modalMetricsQuery.isError,
	]);

	const activeMetricsData = modalMetricsData || metricsData;

	const TimeRangeOffset = 1000000000;

	const handleModalTimeChange = useCallback(
		(interval: Time | CustomTimeType, dateTimeRange?: [number, number]): void => {
			setParams({ modalSelectedTimeInterval: interval as string });

			if (interval === 'custom' && dateTimeRange) {
				const newRange = {
					startTime: Math.floor(dateTimeRange[0] / 1000),
					endTime: Math.floor(dateTimeRange[1] / 1000),
				};
				setParams({ modalSelectedTimeRange: newRange });
			} else {
				const { maxTime, minTime } = GetMinMax(interval);

				const newRange = {
					startTime: Math.floor(minTime / TimeRangeOffset),
					endTime: Math.floor(maxTime / TimeRangeOffset),
				};
				setParams({ modalSelectedTimeRange: newRange });
			}
		},
		[setParams],
	);

	useEffect(() => {
		if (!isExpanded) {
			setParams({
				modalSelectedTimeRange: undefined,
				modalSelectedTimeInterval: undefined,
			});
		}
	}, [isExpanded, setParams]);

	const [rateOverTimeWidget, latencyOverTimeWidget] = useMemo(
		() => [
			getRateOverTimeWidgetData(domainName, endPointName, filters),
			getLatencyOverTimeWidgetData(domainName, endPointName, filters),
		],
		[domainName, endPointName, filters],
	);

	// // [TODO] Fix this later
	const onDragSelect = useCallback(
		(start: number, end: number) => {
			const startTimestamp = Math.trunc(start);
			const endTimestamp = Math.trunc(end);

			if (startTimestamp !== endTimestamp) {
				// update the value in local time picker
				handleTimeChange('custom', [startTimestamp, endTimestamp]);
			}
		},
		[handleTimeChange],
	);

	return (
		<div className="endpoint-details-container">
			<div className="endpoint-details-filters-container">
				<div className="endpoint-details-filters-container-dropdown">
					<EndPointsDropDown
						selectedEndPointName={endPointName}
						setSelectedEndPointName={setSelectedEndPointName}
						endPointDropDownDataQuery={endPointDropDownDataQuery}
						parentContainerDiv=".endpoint-details-filters-container"
						dropdownStyle={{ width: 'calc(100% - 36px)' }}
					/>
				</div>
				<div className="endpoint-details-filters-container-search">
					<QueryBuilderSearchV2
						query={query}
						onChange={handleFilterChange}
						placeholder="Search for filters..."
					/>
				</div>
			</div>
			<div className="endpoint-meta-data">
				<div className="endpoint-meta-data-pill">
					<div className="endpoint-meta-data-label">Endpoint</div>
					<div className="endpoint-meta-data-value">
						{endpoint || 'All Endpoints'}
					</div>
				</div>
				<div className="endpoint-meta-data-pill">
					<div className="endpoint-meta-data-label">Port</div>
					<div className="endpoint-meta-data-value">{port || '-'}</div>
				</div>
			</div>
			<EndPointMetrics endPointMetricsDataQuery={endPointMetricsDataQuery} />
			{!isServicesFilterApplied && (
				<DependentServices
					dependentServicesQuery={endPointDependentServicesDataQuery}
					timeRange={timeRange}
				/>
			)}
			<StatusCodeBarCharts
				endPointStatusCodeBarChartsDataQuery={endPointStatusCodeBarChartsDataQuery}
				endPointStatusCodeLatencyBarChartsDataQuery={
					endPointStatusCodeLatencyBarChartsDataQuery
				}
				domainName={domainName}
				filters={filters}
				timeRange={timeRange}
				onDragSelect={onDragSelect}
			/>
			<StatusCodeTable endPointStatusCodeDataQuery={endPointStatusCodeDataQuery} />
			<MetricOverTimeGraph
				widget={rateOverTimeWidget}
				timeRange={timeRange}
				onDragSelect={onDragSelect}
			/>
			<MetricOverTimeGraph
				widget={latencyOverTimeWidget}
				timeRange={timeRange}
				onDragSelect={onDragSelect}
				expandedViewFooter={
					<Card
						bordered
						style={{
							background: 'var(--l1-background)',
							borderColor: 'var(--l1-border)',
							borderRadius: '8px',
							fontFamily:
								'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
						}}
						headStyle={{
							borderBottom: 'none',
							padding: '16px 16px 8px 16px',
							minHeight: 'auto',
							fontWeight: 600,
							fontSize: '14px',
							color: 'var(--l1-foreground)',
							fontFamily:
								'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
						}}
						bodyStyle={{
							padding: '0 16px 16px 16px',
							fontFamily:
								'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
							fontSize: '14px',
							color: 'var(--l2-foreground)',
						}}
						title="Latency Percentiles"
						extra={
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								{(modalMetricsQuery.isLoading || modalMetricsQuery.isFetching) && (
									<Spin size="small" />
								)}
								<DateTimeSelectionV2
									showAutoRefresh={false}
									showRefreshText={false}
									onTimeChange={handleModalTimeChange}
									defaultRelativeTime="5m"
									isModalTimeSelection
									modalSelectedInterval={
										(params.modalSelectedTimeInterval as Time) ||
										(params.selectedInterval as Time) ||
										'5m'
									}
									modalInitialStartTime={modalSelectedTimeRange.startTime * 1000}
									modalInitialEndTime={modalSelectedTimeRange.endTime * 1000}
								/>
							</div>
						}
					>
						<div style={{ gap: '24px' }}>
							<div
								style={{
									display: 'flex',
									gap: '24px',
									flexWrap: 'wrap',
									paddingBottom: '5px',
								}}
							>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#52c41a',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>P50:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.p50Latency !== undefined &&
										activeMetricsData?.p50Latency !== '-'
											? `${activeMetricsData.p50Latency} ms`
											: '-'}
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#1890ff',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>P90:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.p90Latency !== undefined &&
										activeMetricsData?.p90Latency !== '-'
											? `${activeMetricsData.p90Latency} ms`
											: '-'}
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#fa8c16',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>P95:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.p95Latency !== undefined &&
										activeMetricsData?.p95Latency !== '-'
											? `${activeMetricsData.p95Latency} ms`
											: '-'}
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#f5222d',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>P99:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.p99Latency !== undefined &&
										activeMetricsData?.p99Latency !== '-'
											? `${activeMetricsData.p99Latency} ms`
											: '-'}
									</span>
								</div>
							</div>
							<div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#722ed1',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>Avg:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.avgLatency !== undefined &&
										activeMetricsData?.avgLatency !== '-'
											? `${activeMetricsData.avgLatency} ms`
											: '-'}
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#eb2f96',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>Max:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.maxLatency !== undefined &&
										activeMetricsData?.maxLatency !== '-'
											? `${activeMetricsData.maxLatency} ms`
											: '-'}
									</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span
										style={{
											width: '12px',
											height: '12px',
											borderRadius: '50%',
											background: '#13c2c2',
											display: 'inline-block',
										}}
									/>
									<span style={{ color: 'var(--l2-foreground)' }}>Min:</span>
									<span style={{ color: 'var(--l1-foreground)' }}>
										{activeMetricsData?.minLatency !== undefined &&
										activeMetricsData?.minLatency !== '-'
											? `${activeMetricsData.minLatency} ms`
											: '-'}
									</span>
								</div>
							</div>
						</div>
					</Card>
				}
			/>
		</div>
	);
}

export default EndPointDetails;
