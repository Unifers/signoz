import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from 'react-query';
// oxlint-disable-next-line no-restricted-imports
import { useSelector } from 'react-redux';
import {
	Button,
	Form,
	Input,
	InputNumber,
	Modal,
	Spin,
	Table,
	Tooltip,
} from 'antd';
import { Badge } from '@signozhq/ui/badge';
import { Settings, Settings2, Loader, Filter } from '@signozhq/icons';
import { Color } from '@signozhq/design-tokens';
import logEvent from 'api/common/logEvent';
import emptyStateUrl from 'assets/Icons/emptyState.svg';
import cx from 'classnames';
import QuerySearch from 'components/QueryBuilderV2/QueryV2/QuerySearch/QuerySearch';
import QueryCancelledPlaceholder from 'components/QueryCancelledPlaceholder';
import QuickFilters from 'components/QuickFilters/QuickFilters';
import HeaderRightSection from 'components/HeaderRightSection/HeaderRightSection';
import { QuickFiltersSource, SignalType } from 'components/QuickFilters/types';
import { initialQueriesMap } from 'constants/queryBuilder';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import RightToolbarActions from 'container/QueryBuilder/components/ToolbarActions/RightToolbarActions';
import Toolbar from 'container/Toolbar/Toolbar';
import { useGetCompositeQueryParam } from 'hooks/queryBuilder/useGetCompositeQueryParam';
import { useQueryBuilder } from 'hooks/queryBuilder/useQueryBuilder';
import { useQueryOperations } from 'hooks/queryBuilder/useQueryBuilderOperations';
import { useShareBuilderUrl } from 'hooks/queryBuilder/useShareBuilderUrl';

import { get } from 'lodash-es';
import { AppState } from 'store/reducers';
import { BaseAutocompleteData } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { HandleChangeQueryDataV5 } from 'types/common/operations.types';
import { DataSource } from 'types/common/queryBuilder';
import { GlobalReducer } from 'types/reducer/globalTime';
import { ApiMonitoringHardcodedAttributeKeys } from '../../container/ApiMonitoring/constants';

import DomainDetails from 'container/ApiMonitoring/Explorer/Domains/DomainDetails/DomainDetails';
import {
	DEFAULT_PARAMS,
	useApiMonitoringParams,
} from 'container/ApiMonitoring/queryParams';
import { APIDomainsRowData } from 'container/ApiMonitoring/types';
import { formatDataForTable } from 'container/ApiMonitoring/utils';
import { useListOverview } from 'hooks/thirdPartyApis/useListOverview';
import getLocalStorageKey from 'api/browser/localstorage/get';
import setLocalStorageKey from 'api/browser/localstorage/set';

import 'container/ApiMonitoring/Explorer/Explorer.styles.scss';
import './ExternalApiPage.styles.scss';

// Configuration keys for localstorage
const STORAGE_KEYS = {
	GLOBAL_RULES: 'external_api_rules_global',
	API_RULES: 'external_api_rules_by_api',
};

interface RuleConfig {
	errorCodes: string;
	warningCodes: string;
	successErrorRate: number;
	warningErrorRate: number;
}

interface ExternalApiRowData {
	key: string;
	endpoint: string;
	status: 'success' | 'warning' | 'error';
	lastUsed: string;
	rate: number;
	errorRate: number;
	warningRate: number;
	successRate: number;
	latency: number;
	p99Latency: number;
	totalCount: number;
}

const DEFAULT_GLOBAL_RULE: RuleConfig = {
	errorCodes: '5xx,',
	warningCodes: '4xx',
	successErrorRate: 5,
	warningErrorRate: 10,
};

const stripQueryParams = (url: string): string => {
	if (!url) {
		return '';
	}
	return url.split('?')[0];
};

const getHostFromUrl = (urlStr: string): string => {
	try {
		const absoluteUrl =
			urlStr.startsWith('http://') || urlStr.startsWith('https://')
				? urlStr
				: `https://${urlStr}`;
		const parsed = new URL(absoluteUrl);
		// Retain port if it was explicitly present in the original string, matching OTel http_host headers
		const portMatch = absoluteUrl.match(/(?:https?:\/\/)?([^/]+)/);
		if (portMatch) {
			const hostPart = portMatch[1];
			if (hostPart.includes(':')) {
				return hostPart;
			}
		}
		return parsed.host;
	} catch {
		return urlStr;
	}
};

const formatEndpointLabel = (endpoint: string): string => {
	if (!endpoint) {
		return '';
	}
	return endpoint.replace(/^(https?:\/\/)?(www\.)?/, '');
};

function ExternalApiPage(): JSX.Element {
	const [params, setParams] = useApiMonitoringParams();
	const { selectedDomain } = params;

	const { maxTime, minTime } = useSelector<AppState, GlobalReducer>(
		(state) => state.globalTime,
	);

	const queryClient = useQueryClient();
	const { currentQuery, handleRunQuery } = useQueryBuilder();
	const query = useMemo(
		() => currentQuery?.builder?.queryData[0] || null,
		[currentQuery],
	);

	const { handleChangeQueryData } = useQueryOperations({
		index: 0,
		query,
		entityVersion: '',
	});

	const compositeData = useGetCompositeQueryParam();
	const [isCancelled, setIsCancelled] = useState(false);
	const [showQuickFilters, setShowQuickFilters] = useState(true);

	// Load threshold rules from LocalStorage
	const [globalRule, setGlobalRule] = useState<RuleConfig>(() => {
		try {
			const saved = getLocalStorageKey(STORAGE_KEYS.GLOBAL_RULES);
			return saved ? JSON.parse(saved) : DEFAULT_GLOBAL_RULE;
		} catch {
			return DEFAULT_GLOBAL_RULE;
		}
	});

	const [apiRules, setApiRules] = useState<Record<string, RuleConfig>>(() => {
		try {
			const saved = getLocalStorageKey(STORAGE_KEYS.API_RULES);
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	// Modal states
	const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
	const [editingApi, setEditingApi] = useState<string | null>(null);
	const [form] = Form.useForm();
	const [globalForm] = Form.useForm();

	const filterExpression = get(
		compositeData,
		'builder.queryData[0].filter.expression',
		'',
	);

	// Fetch data via useListOverview
	const queryResponse = useListOverview({
		start: minTime,
		end: maxTime,
		show_ip: false,
		group_by_url: true,
		filter: {
			expression: filterExpression
				? `kind_string = 'Client' AND ${filterExpression}`
				: `kind_string = 'Client'`,
		},
		globalRule,
		apiRules,
	});

	// Share / Initialize QuickFilters state
	useShareBuilderUrl({
		defaultValue: {
			...initialQueriesMap.traces,
			builder: {
				...initialQueriesMap.traces.builder,
				queryData: [
					{
						...initialQueriesMap.traces.builder.queryData[0],
						dataSource: DataSource.TRACES,
						aggregateOperator: 'noop',
						aggregateAttribute: {
							...(initialQueriesMap.traces.builder.queryData[0]
								.aggregateAttribute as BaseAutocompleteData),
						},
					},
				],
			},
		},
	});

	// Handle search filter change
	const handleSearchChange = useCallback(
		(value: string) => {
			(handleChangeQueryData as HandleChangeQueryDataV5)('filter', {
				expression: value,
			});
		},
		[handleChangeQueryData],
	);

	const handleCancelQuery = useCallback(() => {
		queryClient.cancelQueries([REACT_QUERY_KEY.GET_DOMAINS_LIST]);
		setIsCancelled(true);
	}, [queryClient]);

	const handleStageAndRunQuery = useCallback(() => {
		setIsCancelled(false);
		queryClient.invalidateQueries([REACT_QUERY_KEY.GET_DOMAINS_LIST]);
		handleRunQuery();
	}, [queryClient, handleRunQuery]);

	// Parse and Aggregate results - strip query params and merge rows with same path
	const aggregatedData = useMemo(() => {
		const results = (queryResponse.data as any)?.data?.data?.data?.results?.[0];
		const columns = results?.columns || [];
		const rows = results?.data || [];

		const formattedRows = formatDataForTable(rows, columns);

		// Time-range in seconds (minTime / maxTime are in nanoseconds)
		const timeRangeSeconds = (maxTime - minTime) / 1_000_000_000;

		// Group rows by path-without-query-params, merging metrics for same endpoint
		const groupedMap = new Map<string, ExternalApiRowData>();

		formattedRows.forEach((row) => {
			// Strip query params to get the canonical endpoint key
			const cleanEndpoint = stripQueryParams(String(row.domainName || ''));
			const activeRule =
				apiRules[cleanEndpoint] || apiRules[row.domainName] || globalRule;

			const errorRate =
				typeof row.errorRate === 'number'
					? row.errorRate
					: Number(row.errorRate) || 0;
			const warningRate =
				typeof row.warningRate === 'number'
					? row.warningRate
					: Number(row.warningRate) || 0;
			const rateVal =
				typeof row.rate === 'number' ? row.rate : Number(row.rate) || 0;
			const latencyVal =
				typeof row.latency === 'number' ? row.latency : Number(row.latency) || 0;
			const p99LatencyVal =
				typeof row.p99Latency === 'number'
					? row.p99Latency
					: Number(row.p99Latency) || 0;
			const lastUsedVal = row.lastUsed;
			// Estimate total requests for this row from rate × time-range
			const rowTotalCount = Math.round(rateVal * timeRangeSeconds);

			if (groupedMap.has(cleanEndpoint)) {
				// Merge into existing entry: sum rates, average error/latency, keep latest lastUsed
				const existing = groupedMap.get(cleanEndpoint)!;
				const mergedRate = Number((existing.rate + rateVal).toFixed(2));
				// Weighted average for error/warning rates based on merged rate
				const totalRate = existing.rate + rateVal;
				const mergedErrorRate =
					totalRate > 0
						? (existing.errorRate * existing.rate + errorRate * rateVal) / totalRate
						: (existing.errorRate + errorRate) / 2;
				const mergedWarningRate =
					totalRate > 0
						? (existing.warningRate * existing.rate + warningRate * rateVal) /
							totalRate
						: (existing.warningRate + warningRate) / 2;
				// Keep max latency (p99 is a worst-case metric; avg latency: simple average)
				const mergedLatency = (existing.latency + latencyVal) / 2;
				const mergedP99 = Math.max(existing.p99Latency, p99LatencyVal);
				// Keep the most recent lastUsed
				const mergedLastUsed =
					lastUsedVal && existing.lastUsed
						? new Date(lastUsedVal) > new Date(existing.lastUsed)
							? lastUsedVal
							: existing.lastUsed
						: lastUsedVal || existing.lastUsed;

				groupedMap.set(cleanEndpoint, {
					...existing,
					rate: mergedRate,
					errorRate: mergedErrorRate,
					warningRate: mergedWarningRate,
					successRate: 100 - mergedErrorRate - mergedWarningRate,
					latency: mergedLatency,
					p99Latency: mergedP99,
					lastUsed: mergedLastUsed,
					totalCount: existing.totalCount + rowTotalCount,
					// status will be recalculated below
				});
			} else {
				groupedMap.set(cleanEndpoint, {
					key: cleanEndpoint,
					endpoint: cleanEndpoint,
					status: 'success', // placeholder, recalculated below
					lastUsed: lastUsedVal,
					rate: Number(rateVal.toFixed(2)),
					errorRate,
					warningRate,
					successRate: 100 - errorRate - warningRate,
					latency: latencyVal,
					p99Latency: p99LatencyVal,
					totalCount: rowTotalCount,
					_activeRule: activeRule,
				} as any);
			}
		});

		// Recalculate status for each merged group
		return Array.from(groupedMap.values()).map((item) => {
			const activeRule =
				(item as any)._activeRule || apiRules[item.endpoint] || globalRule;
			const successThreshold =
				activeRule.successErrorRate !== undefined &&
				activeRule.successErrorRate !== null
					? activeRule.successErrorRate
					: 5;
			const warningThreshold =
				activeRule.warningErrorRate !== undefined &&
				activeRule.warningErrorRate !== null
					? activeRule.warningErrorRate
					: 10;

			let status: 'success' | 'warning' | 'error' = 'success';
			if (item.errorRate > warningThreshold) {
				status = 'error';
			} else if (
				item.errorRate > successThreshold ||
				item.warningRate > successThreshold
			) {
				status = 'warning';
			}

			return {
				key: item.endpoint,
				endpoint: item.endpoint,
				status,
				lastUsed: item.lastUsed,
				rate: Number(item.rate.toFixed(2)),
				errorRate: item.errorRate,
				warningRate: item.warningRate,
				successRate: 100 - item.errorRate - item.warningRate,
				latency: item.latency,
				p99Latency: item.p99Latency,
				totalCount: item.totalCount,
			};
		});
	}, [queryResponse.data, globalRule, apiRules, minTime, maxTime]);

	const selectedDomainData = useMemo<APIDomainsRowData | null>(() => {
		if (!selectedDomain) {
			return null;
		}
		const matchedRow = aggregatedData.find(
			(item) => getHostFromUrl(item.endpoint) === selectedDomain,
		);
		if (!matchedRow) {
			return null;
		}
		return {
			key: matchedRow.key,
			domainName: selectedDomain,
			endpointCount: 1,
			rate: matchedRow.rate,
			errorRate: matchedRow.errorRate,
			latency: matchedRow.latency,
			p99Latency: matchedRow.p99Latency,
			lastUsed: matchedRow.lastUsed,
		};
	}, [selectedDomain, aggregatedData]);

	// Open Individual API Settings Modal
	const openApiSettings = (endpoint: string): void => {
		const current = apiRules[endpoint] || globalRule;
		form.setFieldsValue(current);
		setEditingApi(endpoint);
	};

	// Save Individual API Settings
	const saveApiSettings = (values: RuleConfig): void => {
		if (editingApi) {
			const updated = {
				...apiRules,
				[editingApi]: values,
			};
			setApiRules(updated);
			setLocalStorageKey(STORAGE_KEYS.API_RULES, JSON.stringify(updated));
			setEditingApi(null);
		}
	};

	// Open Global Settings Modal
	const openGlobalSettings = (): void => {
		globalForm.setFieldsValue(globalRule);
		setIsGlobalModalOpen(true);
	};

	// Save Global Settings
	const saveGlobalSettings = (values: RuleConfig): void => {
		setGlobalRule(values);
		setLocalStorageKey(STORAGE_KEYS.GLOBAL_RULES, JSON.stringify(values));
		setIsGlobalModalOpen(false);
	};

	const columns = [
		{
			title: 'Status',
			dataIndex: 'status',
			key: 'status',
			width: '10%',
			render: (status: 'success' | 'warning' | 'error'): JSX.Element => {
				if (status === 'error') {
					return (
						<Badge color="error" variant="outline">
							Error
						</Badge>
					);
				}
				if (status === 'warning') {
					return (
						<Badge color="warning" variant="outline">
							Warning
						</Badge>
					);
				}
				return (
					<Badge color="success" variant="outline">
						Success
					</Badge>
				);
			},
			filters: [
				{ text: 'Success', value: 'success' },
				{ text: 'Warning', value: 'warning' },
				{ text: 'Error', value: 'error' },
			],
			onFilter: (value: any, record: ExternalApiRowData): boolean =>
				record.status === value,
		},
		{
			title: 'API Endpoint',
			dataIndex: 'endpoint',
			key: 'endpoint',
			width: '30%',
			align: 'left' as const,
			className: 'column column-domain-name',
			render: (endpoint: string): JSX.Element => (
				<div
					className="api-endpoint-cell"
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'flex-start',
						gap: 8,
					}}
				>
					<Tooltip title="Configure status thresholds">
						<Settings2
							size={14}
							className="settings-icon-btn"
							style={{ cursor: 'pointer', flexShrink: 0 }}
							onClick={(e) => {
								e.stopPropagation();
								openApiSettings(endpoint);
							}}
						/>
					</Tooltip>
					<span className="domain-list-name-col-value">
						{formatEndpointLabel(endpoint)}
					</span>
				</div>
			),
		},
		{
			title: 'Last Used',
			dataIndex: 'lastUsed',
			key: 'lastUsed',
			width: '10%',
			render: (lastUsed: string): string => {
				if (!lastUsed) {
					return '-';
				}
				const diffMs = Date.now() - new Date(lastUsed).getTime();
				const mins = Math.floor(diffMs / 60000);
				if (mins < 1) {
					return 'Just now';
				}
				if (mins < 60) {
					return `${mins}m ago`;
				}
				const hrs = Math.floor(mins / 60);
				if (hrs < 24) {
					return `${hrs}h ago`;
				}
				return `${Math.floor(hrs / 24)}d ago`;
			},
		},
		{
			title: (
				<div>
					Rate <span className="round-metric-tag">ops/s</span>
				</div>
			),
			dataIndex: 'rate',
			key: 'rate',
			width: '10%',
			align: 'right' as const,
			sorter: (a: ExternalApiRowData, b: ExternalApiRowData): number =>
				a.rate - b.rate,
		},
		{
			title: 'Total Requests',
			dataIndex: 'totalCount',
			key: 'totalCount',
			width: '12%',
			align: 'right' as const,
			sorter: (a: ExternalApiRowData, b: ExternalApiRowData): number =>
				a.totalCount - b.totalCount,
			render: (totalCount: number): string =>
				totalCount > 0 ? totalCount.toLocaleString() : '-',
		},
		{
			title: (
				<div>
					Error & Warning Rate <span className="round-metric-tag">%</span>
				</div>
			),
			dataIndex: 'errorRate',
			key: 'errorRate',
			width: '20%',
			sorter: (a: ExternalApiRowData, b: ExternalApiRowData): number =>
				a.errorRate - b.errorRate,
			render: (errorRate: number, record: ExternalApiRowData): JSX.Element => {
				const warningRate = record.warningRate || 0;
				const successRate = 100 - errorRate - warningRate;

				return (
					<div
						className="custom-progress-container"
						style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
					>
						<div
							className="custom-progress-bar-wrapper"
							style={{
								display: 'flex',
								width: '100%',
								height: 8,
								borderRadius: 4,
								overflow: 'hidden',
								backgroundColor: 'var(--l3-background)',
							}}
						>
							{errorRate > 0 && (
								<Tooltip title={`Error: ${errorRate.toFixed(2)}%`}>
									<div
										className="progress-segment error-segment"
										style={{
											width: `${errorRate}%`,
											backgroundColor: Color.BG_SAKURA_500,
										}}
									/>
								</Tooltip>
							)}
							{warningRate > 0 && (
								<Tooltip title={`Warning: ${warningRate.toFixed(2)}%`}>
									<div
										className="progress-segment warning-segment"
										style={{
											width: `${warningRate}%`,
											backgroundColor: Color.BG_AMBER_500,
										}}
									/>
								</Tooltip>
							)}
							{successRate > 0 && (
								<Tooltip title={`Success: ${successRate.toFixed(2)}%`}>
									<div
										className="progress-segment success-segment"
										style={{
											width: `${successRate}%`,
											backgroundColor: Color.BG_FOREST_500,
										}}
									/>
								</Tooltip>
							)}
						</div>
						<div
							className="custom-progress-text"
							style={{
								fontSize: 11,
								color: 'var(--l2-foreground)',
								display: 'flex',
								justifyContent: 'space-between',
							}}
						>
							<span>Err: {errorRate.toFixed(1)}%</span>
							<span>Warn: {warningRate.toFixed(1)}%</span>
						</div>
					</div>
				);
			},
		},
		{
			title: 'Avg. Latency (ms)',
			dataIndex: 'latency',
			key: 'latency',
			width: '12%',
			align: 'right' as const,
			sorter: (a: ExternalApiRowData, b: ExternalApiRowData): number =>
				a.latency - b.latency,
			render: (latency: number): string => `${latency} ms`,
		},
		{
			title: 'p99 Latency (ms)',
			dataIndex: 'p99Latency',
			key: 'p99Latency',
			width: '12%',
			align: 'right' as const,
			sorter: (a: ExternalApiRowData, b: ExternalApiRowData): number =>
				a.p99Latency - b.p99Latency,
			render: (p99Latency: number): string => `${p99Latency} ms`,
		},
	];

	return (
		<div
			className={cx('api-monitoring-page', 'external-api-board-page', {
				'filter-visible': showQuickFilters,
			})}
		>
			{showQuickFilters && (
				<section className="api-quick-filter-left-section">
					<QuickFilters
						className="qf-api-monitoring"
						source={QuickFiltersSource.API_MONITORING}
						signal={SignalType.API_MONITORING}
						showFilterCollapse={true}
						showQueryName={false}
						handleFilterVisibilityChange={(): void => {
							setShowQuickFilters(false);
						}}
					/>
				</section>
			)}

			<section className={cx('api-module-right-section')}>
				<div
					className="external-api-header-bar"
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						padding: '12px 16px 0 16px',
					}}
				>
					<HeaderRightSection
						enableAnnouncements={false}
						enableShare
						enableFeedback
					/>
				</div>
				<Toolbar
					showAutoRefresh={true}
					leftActions={
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							{!showQuickFilters && (
								<Tooltip title="Show Quick Filters" placement="right">
									<Button
										icon={<Filter size={14} />}
										onClick={(): void => setShowQuickFilters(true)}
									/>
								</Tooltip>
							)}
							<Button icon={<Settings size={14} />} onClick={openGlobalSettings}>
								Global Threshold Defaults
							</Button>
						</div>
					}
					rightActions={
						<RightToolbarActions
							onStageRunQuery={handleStageAndRunQuery}
							isLoadingQueries={queryResponse.isFetching}
							handleCancelQuery={handleCancelQuery}
						/>
					}
				/>
				<div className="api-monitoring-list-header">
					<QuerySearch
						dataSource={DataSource.TRACES}
						queryData={query}
						onChange={handleSearchChange}
						placeholder="Enter filter query (e.g. deployment.environment = 'otel-demo' AND service.name = 'frontend')"
						hardcodedAttributeKeys={ApiMonitoringHardcodedAttributeKeys}
					/>
				</div>

				<div className="api-board-content">
					{isCancelled && aggregatedData.length === 0 && (
						<QueryCancelledPlaceholder subText='Click "Run Query" to load External API data.' />
					)}

					{!isCancelled &&
						!queryResponse.isFetching &&
						!queryResponse.isLoading &&
						aggregatedData.length === 0 && (
							<div
								className="no-filtered-domains-message-container"
								style={{ textAlign: 'center', padding: 48 }}
							>
								<img
									src={emptyStateUrl}
									alt="empty"
									style={{ width: 120, marginBottom: 16 }}
								/>
								<div
									style={{
										fontSize: 16,
										fontWeight: 500,
										color: 'var(--l1-foreground)',
									}}
								>
									No External API calls detected with applied filters.
								</div>
								<div style={{ color: 'var(--l2-foreground)', marginTop: 8 }}>
									Ensure all HTTP client spans are sent with kind as Client and url set
									in url.full or http.url attribute.
								</div>
							</div>
						)}

					{(queryResponse.isFetching ||
						queryResponse.isLoading ||
						aggregatedData.length > 0) && (
						<Table
							className="api-monitoring-domain-list-table"
							dataSource={
								queryResponse.isFetching || queryResponse.isLoading
									? []
									: aggregatedData
							}
							columns={columns}
							loading={{
								spinning: queryResponse.isFetching || queryResponse.isLoading,
								indicator: (
									<Spin indicator={<Loader size={16} className="animate-spin" />} />
								),
							}}
							pagination={{ defaultPageSize: 20, showSizeChanger: true }}
							onRow={(record, index): { onClick: () => void; className: string } => ({
								onClick: (): void => {
									if (index !== undefined) {
										const domainName = getHostFromUrl(record.endpoint);
										const cleanEndPoint = stripQueryParams(record.endpoint);
										setParams({
											selectedDomain: domainName,
											selectedView: 'endpoint_stats',
											selectedEndPointName: cleanEndPoint,
											endPointDetailsLocalFilters: undefined,
										});
										logEvent('API Monitoring: Domain name row clicked', {});
									}
								},
								className: 'expanded-clickable-row',
							})}
							rowClassName={(_, index): string =>
								index % 2 === 0
									? 'table-row-dark expanded-clickable-row'
									: 'table-row-light expanded-clickable-row'
							}
						/>
					)}
				</div>
			</section>

			{selectedDomain && selectedDomainData && (
				<DomainDetails
					domainData={selectedDomainData}
					selectedDomainIndex={0}
					setSelectedDomainIndex={() => {}}
					domainListLength={1}
					handleClose={(): void => {
						setParams(DEFAULT_PARAMS);
					}}
					domainListFilters={query?.filters}
				/>
			)}

			{/* Modal for global threshold config */}
			<Modal
				title="Configure Global Default Threshold Rules"
				open={isGlobalModalOpen}
				onCancel={() => setIsGlobalModalOpen(false)}
				onOk={() => globalForm.submit()}
				className="threshold-settings-modal"
				destroyOnClose
			>
				<Form form={globalForm} layout="vertical" onFinish={saveGlobalSettings}>
					<Form.Item
						name="errorCodes"
						label="Error Status Codes"
						rules={[{ required: true, message: 'Please specify error status codes' }]}
					>
						<Input placeholder="5xx, (empty for connection failures)" />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Comma-separated codes. Support wildcards like 5xx. Leave trailing/leading
						comma to include empty/network failures.
					</div>

					<Form.Item
						name="warningCodes"
						label="Warning Status Codes"
						rules={[
							{ required: true, message: 'Please specify warning status codes' },
						]}
					>
						<Input placeholder="4xx" />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Comma-separated codes. Support wildcards like 4xx (e.g. 401, 403, 404).
					</div>

					<Form.Item
						name="successErrorRate"
						label="Success Error Rate Threshold (%)"
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Maximum error rate (percentage of requests matching error status codes)
						allowed to mark the API as Success.
					</div>

					<Form.Item
						name="warningErrorRate"
						label="Warning Error Rate Threshold (%)"
						rules={[
							({ getFieldValue }) => ({
								validator(_: any, value: any): Promise<void> {
									if (
										value !== undefined &&
										value !== null &&
										getFieldValue('successErrorRate') !== undefined &&
										getFieldValue('successErrorRate') !== null &&
										value < getFieldValue('successErrorRate')
									) {
										return Promise.reject(
											new Error(
												'Warning threshold must be greater than or equal to success threshold',
											),
										);
									}
									return Promise.resolve();
								},
							}),
						]}
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
					<div className="form-item-description">
						Maximum error rate (percentage of requests matching error status codes)
						allowed to mark the API as Warning. Above this, the API is marked as
						Error.
					</div>
				</Form>
			</Modal>

			{/* Modal for individual API threshold config */}
			<Modal
				title={`Configure Threshold Rules for API`}
				open={!!editingApi}
				onCancel={() => setEditingApi(null)}
				onOk={() => form.submit()}
				className="threshold-settings-modal"
				destroyOnClose
			>
				<div style={{ marginBottom: 16, wordBreak: 'break-all' }}>
					<strong>API Endpoint:</strong> <code>{editingApi}</code>
				</div>
				<Form form={form} layout="vertical" onFinish={saveApiSettings}>
					<Form.Item
						name="errorCodes"
						label="Error Status Codes"
						rules={[{ required: true, message: 'Please specify error status codes' }]}
					>
						<Input placeholder="5xx," />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Comma-separated codes. Support wildcards like 5xx. Leave trailing/leading
						comma to include empty/network failures.
					</div>

					<Form.Item
						name="warningCodes"
						label="Warning Status Codes"
						rules={[
							{ required: true, message: 'Please specify warning status codes' },
						]}
					>
						<Input placeholder="4xx" />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Comma-separated codes. Support wildcards like 4xx.
					</div>

					<Form.Item
						name="successErrorRate"
						label="Success Error Rate Threshold (%)"
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
					<div className="form-item-description" style={{ marginBottom: 16 }}>
						Maximum error rate (percentage of requests matching error status codes)
						allowed to mark the API as Success.
					</div>

					<Form.Item
						name="warningErrorRate"
						label="Warning Error Rate Threshold (%)"
						rules={[
							({ getFieldValue }) => ({
								validator(_: any, value: any): Promise<void> {
									if (
										value !== undefined &&
										value !== null &&
										getFieldValue('successErrorRate') !== undefined &&
										getFieldValue('successErrorRate') !== null &&
										value < getFieldValue('successErrorRate')
									) {
										return Promise.reject(
											new Error(
												'Warning threshold must be greater than or equal to success threshold',
											),
										);
									}
									return Promise.resolve();
								},
							}),
						]}
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
					<div className="form-item-description">
						Maximum error rate (percentage of requests matching error status codes)
						allowed to mark the API as Warning. Above this, the API is marked as
						Error.
					</div>
				</Form>
			</Modal>
		</div>
	);
}

export default ExternalApiPage;
