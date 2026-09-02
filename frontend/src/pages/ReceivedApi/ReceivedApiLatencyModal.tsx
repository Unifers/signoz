import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { Modal, Spin, Tooltip } from 'antd';
import { Badge } from '@signozhq/ui/badge';
import { Activity, Clock } from '@signozhq/icons';
import { ENTITY_VERSION_V5 } from 'constants/app';
import { PANEL_TYPES } from 'constants/queryBuilder';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import GridCard from 'container/GridCardLayout/GridCard';
import DateTimeSelectionV2 from 'container/TopNav/DateTimeSelectionV2';
import {
	CustomTimeType,
	Time,
} from 'container/TopNav/DateTimeSelectionV2/types';
import { ReceivedApiRowData } from 'hooks/receivedApis/useReceivedApiOverview';
import { GetMetricQueryRange } from 'lib/dashboard/getQueryResults';
import GetMinMax from 'lib/getMinMax';
import {
	getWidgetQuery,
	getWidgetQueryBuilder,
} from 'pages/MessagingQueues/MQDetails/MetricPage/MetricPageUtil';
import { Widgets } from 'types/api/dashboard/getAll';
import { EQueryType } from 'types/common/dashboard';
import { DataSource, ReduceOperators } from 'types/common/queryBuilder';

export interface ReceivedApiLatencyModalProps {
	open: boolean;
	onClose: () => void;
	record: ReceivedApiRowData | null;
	globalTimeRange: { startTime: number; endTime: number };
	filterExpression?: string;
}

interface LatencyPercentiles {
	p50: string;
	p90: string;
	p95: string;
	p99: string;
	avg: string;
	max: string;
	min: string;
}

const formatEndpointLabel = (rawEndpoint: string): string => {
	if (!rawEndpoint) {
		return '-';
	}
	try {
		if (rawEndpoint.startsWith('http://') || rawEndpoint.startsWith('https://')) {
			const url = new URL(rawEndpoint);
			return `${url.pathname}${url.search}`;
		}
	} catch {
		// fallback
	}
	return rawEndpoint;
};

const getMethodFromEndpoint = (endpoint?: string): string => {
	if (!endpoint) {
		return 'ROUTE';
	}
	const trimmed = endpoint.trim();
	if (trimmed.startsWith('GET')) {
		return 'GET';
	}
	if (trimmed.startsWith('POST')) {
		return 'POST';
	}
	if (trimmed.startsWith('PUT')) {
		return 'PUT';
	}
	if (trimmed.startsWith('DELETE')) {
		return 'DELETE';
	}
	if (trimmed.startsWith('PATCH')) {
		return 'PATCH';
	}
	return 'API';
};

export const ReceivedApiLatencyModal: React.FC<
	ReceivedApiLatencyModalProps
> = ({ open, onClose, record, globalTimeRange, filterExpression }) => {
	const [selectedTimeInterval, setSelectedTimeInterval] =
		useState<string>('15m');
	const [timeRange, setTimeRange] = useState<{
		startTime: number;
		endTime: number;
	}>(() => {
		const startSec =
			globalTimeRange.startTime > 1e14
				? Math.floor(globalTimeRange.startTime / 1e9)
				: Math.floor(globalTimeRange.startTime / 1e3);
		const endSec =
			globalTimeRange.endTime > 1e14
				? Math.floor(globalTimeRange.endTime / 1e9)
				: Math.floor(globalTimeRange.endTime / 1e3);
		return { startTime: startSec, endTime: endSec };
	});

	// Sync with global time range on open
	useEffect(() => {
		if (open) {
			const startSec =
				globalTimeRange.startTime > 1e14
					? Math.floor(globalTimeRange.startTime / 1e9)
					: Math.floor(globalTimeRange.startTime / 1e3);
			const endSec =
				globalTimeRange.endTime > 1e14
					? Math.floor(globalTimeRange.endTime / 1e9)
					: Math.floor(globalTimeRange.endTime / 1e3);
			setTimeRange({ startTime: startSec, endTime: endSec });
			setSelectedTimeInterval('15m');
		}
	}, [open, globalTimeRange]);

	const handleTimeChange = useCallback(
		(interval: Time | CustomTimeType, dateTimeRange?: [number, number]): void => {
			setSelectedTimeInterval(interval as string);

			if (interval === 'custom' && dateTimeRange) {
				const newRange = {
					startTime: Math.floor(dateTimeRange[0] / 1000),
					endTime: Math.floor(dateTimeRange[1] / 1000),
				};
				setTimeRange(newRange);
			} else {
				const { maxTime, minTime } = GetMinMax(interval);
				const newRange = {
					startTime: Math.floor(minTime / 1e9),
					endTime: Math.floor(maxTime / 1e9),
				};
				setTimeRange(newRange);
			}
		},
		[],
	);

	const onDragSelect = useCallback((start: number, end: number): void => {
		const startSec = Math.floor(start / 1000);
		const endSec = Math.floor(end / 1000);
		if (startSec !== endSec) {
			setSelectedTimeInterval('custom');
			setTimeRange({ startTime: startSec, endTime: endSec });
		}
	}, []);

	// Scoped filter expression
	const filterExpr = useMemo(() => {
		const parts = ["kind_string = 'Server'"];
		if (record) {
			if (record.serviceName && record.serviceName !== '-') {
				parts.push(`service.name = '${record.serviceName}'`);
			}
			if (record.httpUrl && record.httpUrl !== '-') {
				parts.push(`http_url = '${record.httpUrl}'`);
			} else if (record.endpoint && record.endpoint !== '-') {
				parts.push(`name = '${record.endpoint}'`);
			}
		}
		if (filterExpression) {
			parts.push(`(${filterExpression})`);
		}
		return parts.join(' AND ');
	}, [record, filterExpression]);

	// Scalar query payload for the 7 latency percentiles
	const percentilesQueryPayload = useMemo(
		() => ({
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
			start: timeRange.startTime,
			end: timeRange.endTime,
		}),
		[filterExpr, timeRange.startTime, timeRange.endTime],
	);

	const percentilesQuery = useQuery(
		[
			REACT_QUERY_KEY.GET_ENDPOINT_METRICS_DATA,
			'received-api-percentiles',
			percentilesQueryPayload,
			ENTITY_VERSION_V5,
		],
		() => GetMetricQueryRange(percentilesQueryPayload as any, ENTITY_VERSION_V5),
		{
			enabled: open,
			keepPreviousData: true,
			staleTime: 30000,
		},
	);

	const percentilesData: LatencyPercentiles = useMemo(() => {
		const empty: LatencyPercentiles = {
			p50: '-',
			p90: '-',
			p95: '-',
			p99: '-',
			avg: '-',
			max: '-',
			min: '-',
		};

		if (!percentilesQuery.data) {
			return empty;
		}

		const rows =
			percentilesQuery.data?.payload?.data?.result?.[0]?.table?.rows ||
			percentilesQuery.data?.payload?.data?.newResult?.data?.result?.[0]?.table
				?.rows;

		if (!rows || rows.length === 0) {
			return empty;
		}

		const rowData = rows[0]?.data || {};

		const getMs = (val: unknown): string => {
			if (val === undefined || val === null || val === '' || val === 'n/a') {
				return '-';
			}
			const num = Number(val);
			if (isNaN(num)) {
				return '-';
			}
			return (Math.round((num / 1e6) * 10) / 10).toLocaleString();
		};

		return {
			p50: getMs(rowData.A),
			p90: getMs(rowData.B),
			p95: getMs(rowData.C),
			p99: getMs(rowData.D),
			avg: getMs(rowData.E),
			max: getMs(rowData.F),
			min: getMs(rowData.G),
		};
	}, [percentilesQuery.data]);

	// Latency Over Time widget for the time-series graph (actual request latency)
	const latencyOverTimeWidget: Widgets = useMemo(
		() =>
			getWidgetQueryBuilder({
				...getWidgetQuery({
					title: 'Latency Over Time',
					description: 'Actual request latency over time.',
					panelTypes: PANEL_TYPES.TIME_SERIES,
					yAxisUnit: 'ns',
					queryData: [
						{
							aggregations: [{ expression: 'avg(duration_nano)' }],
							aggregateOperator: 'avg',
							dataSource: DataSource.TRACES,
							disabled: false,
							expression: 'A',
							filter: { expression: filterExpr },
							functions: [],
							groupBy: [],
							having: [],
							legend: record?.endpoint
								? formatEndpointLabel(record.endpoint)
								: 'Actual Latency',
							limit: null,
							orderBy: [],
							queryName: 'A',
							reduceTo: ReduceOperators.AVG,
							spaceAggregation: 'avg',
							stepInterval: null,
							timeAggregation: 'avg',
						},
					],
				}),
				id: 'received-api-latency-over-time-widget',
			}),
		[filterExpr, record],
	);

	const statsCards = [
		{ label: 'P50', value: percentilesData.p50, color: '#52c41a' },
		{ label: 'P90', value: percentilesData.p90, color: '#1890ff' },
		{ label: 'P95', value: percentilesData.p95, color: '#fa8c16' },
		{ label: 'P99', value: percentilesData.p99, color: '#f5222d' },
		{ label: 'Avg', value: percentilesData.avg, color: '#722ed1' },
		{ label: 'Max', value: percentilesData.max, color: '#eb2f96' },
		{ label: 'Min', value: percentilesData.min, color: '#13c2c2' },
	];

	return (
		<Modal
			open={open}
			onCancel={onClose}
			footer={null}
			width={1160}
			style={{ maxWidth: '92vw', top: 32 }}
			className="received-api-latency-modal"
			destroyOnClose
			title={
				<div className="latency-modal-title">
					<Activity size={18} className="title-icon" />
					<span className="title-text">
						{record ? 'API Latency Details' : 'Received APIs Latency Overview'}
					</span>
					{record?.serviceName && record.serviceName !== '-' && (
						<Badge color="robin" className="service-tag">
							{record.serviceName}
						</Badge>
					)}
				</div>
			}
		>
			<div className="latency-modal-content">
				{/* Controls & Endpoint Banner */}
				<div className="latency-controls-bar">
					<div className="endpoint-info">
						{record ? (
							<>
								<span className="endpoint-method-badge">
									{getMethodFromEndpoint(record.endpoint)}
								</span>
								<code className="endpoint-code" title={record.endpoint}>
									{formatEndpointLabel(record.endpoint)}
								</code>
								{record.httpUrl && record.httpUrl !== record.endpoint && (
									<Tooltip title={record.httpUrl}>
										<span className="endpoint-url-hint">({record.httpUrl})</span>
									</Tooltip>
								)}
							</>
						) : (
							<span className="all-apis-hint">
								Aggregated latency metrics across all received server requests
							</span>
						)}
					</div>

					<div className="time-picker-wrapper">
						<DateTimeSelectionV2
							showAutoRefresh={false}
							showRefreshText={false}
							onTimeChange={handleTimeChange}
							defaultRelativeTime="15m"
							isModalTimeSelection
							modalSelectedInterval={(selectedTimeInterval as Time) || '15m'}
							modalInitialStartTime={timeRange.startTime * 1000}
							modalInitialEndTime={timeRange.endTime * 1000}
						/>
					</div>
				</div>

				{/* 7 Latency Percentiles Cards */}
				<div className="latency-percentiles-grid">
					{statsCards.map((stat) => (
						<div key={stat.label} className="latency-stat-card">
							<div className="stat-card-header">
								<span
									className="stat-color-dot"
									style={{ backgroundColor: stat.color }}
								/>
								<span className="stat-card-label">{stat.label}</span>
							</div>
							<div className="stat-card-value">
								{percentilesQuery.isLoading && !percentilesQuery.data ? (
									<Spin size="small" />
								) : (
									<>
										<span className="stat-number">{stat.value}</span>
										{stat.value !== '-' && <span className="stat-unit">ms</span>}
									</>
								)}
							</div>
						</div>
					))}
				</div>

				{/* Latency Over Time Time-Series Graph */}
				<div className="latency-graph-section">
					<div className="graph-section-header">
						<div className="graph-title">
							<Clock size={14} style={{ marginRight: 6 }} />
							<span>Latency Over Time</span>
						</div>
						<div className="graph-hint">
							Drag across the graph to zoom into a specific time window
						</div>
					</div>

					<div className="graph-card-wrapper">
						<GridCard
							widget={latencyOverTimeWidget}
							isQueryEnabled={open}
							headerMenuList={[]}
							onDragSelect={onDragSelect}
							customOnDragSelect={(): void => {}}
							customTimeRange={timeRange}
							customTimeRangeWindowForCoRelation="5m"
							version={ENTITY_VERSION_V5}
						/>
					</div>
				</div>
			</div>
		</Modal>
	);
};

export default ReceivedApiLatencyModal;
