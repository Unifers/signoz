import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Settings, Settings2, Loader, Filter, Activity } from '@signozhq/icons';
import ReceivedApiLatencyModal from './ReceivedApiLatencyModal';
import { Color } from '@signozhq/design-tokens';
import logEvent from 'api/common/logEvent';
import getLocalStorageKey from 'api/browser/localstorage/get';
import setLocalStorageKey from 'api/browser/localstorage/set';
import emptyStateUrl from 'assets/Icons/emptyState.svg';
import cx from 'classnames';
import QuerySearch from 'components/QueryBuilderV2/QueryV2/QuerySearch/QuerySearch';
import QueryCancelledPlaceholder from 'components/QueryCancelledPlaceholder';
import QuickFilters from 'components/QuickFilters/QuickFilters';
import HeaderRightSection from 'components/HeaderRightSection/HeaderRightSection';
import { QuickFiltersSource, SignalType } from 'components/QuickFilters/types';
import { v4 as uuid } from 'uuid';
import { QueryParams } from 'constants/query';
import { initialQueriesMap, PANEL_TYPES } from 'constants/queryBuilder';
import { REACT_QUERY_KEY } from 'constants/reactQueryKeys';
import ROUTES from 'constants/routes';
import RightToolbarActions from 'container/QueryBuilder/components/ToolbarActions/RightToolbarActions';
import Toolbar from 'container/Toolbar/Toolbar';
import { useGetCompositeQueryParam } from 'hooks/queryBuilder/useGetCompositeQueryParam';
import { useQueryBuilder } from 'hooks/queryBuilder/useQueryBuilder';
import { useQueryOperations } from 'hooks/queryBuilder/useQueryBuilderOperations';
import { useShareBuilderUrl } from 'hooks/queryBuilder/useShareBuilderUrl';
import { useSafeNavigate } from 'hooks/useSafeNavigate';
import useDebounce from 'hooks/useDebounce';
import { get } from 'lodash-es';
import { AppState } from 'store/reducers';
import {
	BaseAutocompleteData,
	DataTypes,
} from 'types/api/queryBuilder/queryAutocompleteResponse';
import { Query, TagFilterItem } from 'types/api/queryBuilder/queryBuilderData';
import { HandleChangeQueryDataV5 } from 'types/common/operations.types';
import { DataSource } from 'types/common/queryBuilder';
import { GlobalReducer } from 'types/reducer/globalTime';
import { ApiMonitoringHardcodedAttributeKeys } from 'container/ApiMonitoring/constants';
import {
	DEFAULT_GLOBAL_RULE,
	ReceivedApiRowData,
	RuleConfig,
	useReceivedApiOverview,
} from 'hooks/receivedApis/useReceivedApiOverview';

import 'container/ApiMonitoring/Explorer/Explorer.styles.scss';
import './ReceivedApiPage.styles.scss';

const STORAGE_KEYS = {
	GLOBAL_RULES: 'received_api_rules_global',
	API_RULES: 'received_api_rules_by_api',
};

const formatEndpointLabel = (endpoint: string): string => {
	if (!endpoint) {
		return '';
	}
	return endpoint.replace(/^(https?:\/\/)?(www\.)?/, '');
};

function ReceivedApiPage(): JSX.Element {
	const { maxTime, minTime } = useSelector<AppState, GlobalReducer>(
		(state) => state.globalTime,
	);

	const queryClient = useQueryClient();
	const { safeNavigate } = useSafeNavigate();
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

	// Threshold rules loaded from LocalStorage
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

	// Modals state
	const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
	const [editingApi, setEditingApi] = useState<string | null>(null);
	const [latencyModalRecord, setLatencyModalRecord] =
		useState<ReceivedApiRowData | null>(null);
	const [isLatencyModalOpen, setIsLatencyModalOpen] = useState(false);
	const [form] = Form.useForm();
	const [globalForm] = Form.useForm();

	const filterExpression = get(
		compositeData,
		'builder.queryData[0].filter.expression',
		'',
	);
	const debouncedFilterExpression = useDebounce(filterExpression, 300);

	// Fetch received API requests via super-fast single-pass query
	const {
		data: receivedApisData,
		isLoading,
		isFetching,
		refetch,
	} = useReceivedApiOverview({
		start: minTime,
		end: maxTime,
		filterExpression: debouncedFilterExpression,
		globalRule,
		apiRules,
	});

	// Share / Initialize QuickFilters query builder URL
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

	const handleSearchChange = useCallback(
		(value: string) => {
			(handleChangeQueryData as HandleChangeQueryDataV5)('filter', {
				expression: value,
			});
		},
		[handleChangeQueryData],
	);

	const handleCancelQuery = useCallback(() => {
		queryClient.cancelQueries([REACT_QUERY_KEY.GET_RECEIVED_APIS]);
		setIsCancelled(true);
	}, [queryClient]);

	const handleStageAndRunQuery = useCallback(() => {
		setIsCancelled(false);
		queryClient.invalidateQueries([REACT_QUERY_KEY.GET_RECEIVED_APIS]);
		refetch();
		handleRunQuery();
	}, [queryClient, refetch, handleRunQuery]);

	// Threshold configuration handlers
	const openApiSettings = useCallback(
		(endpoint: string): void => {
			const current = apiRules[endpoint] || globalRule;
			form.setFieldsValue(current);
			setEditingApi(endpoint);
		},
		[apiRules, globalRule, form],
	);

	const saveApiSettings = useCallback(
		(values: RuleConfig): void => {
			if (editingApi) {
				const updated = {
					...apiRules,
					[editingApi]: values,
				};
				setApiRules(updated);
				setLocalStorageKey(STORAGE_KEYS.API_RULES, JSON.stringify(updated));
				setEditingApi(null);
			}
		},
		[editingApi, apiRules],
	);

	const openGlobalSettings = useCallback((): void => {
		globalForm.setFieldsValue(globalRule);
		setIsGlobalModalOpen(true);
	}, [globalRule, globalForm]);

	const saveGlobalSettings = useCallback((values: RuleConfig): void => {
		setGlobalRule(values);
		setLocalStorageKey(STORAGE_KEYS.GLOBAL_RULES, JSON.stringify(values));
		setIsGlobalModalOpen(false);
	}, []);

	useEffect(() => {
		if (editingApi) {
			const current = apiRules[editingApi] || globalRule;
			form.setFieldsValue(current);
		}
	}, [editingApi, apiRules, globalRule, form]);

	useEffect(() => {
		if (isGlobalModalOpen) {
			globalForm.setFieldsValue(globalRule);
		}
	}, [isGlobalModalOpen, globalRule, globalForm]);

	const openLatencyModal = useCallback(
		(record: ReceivedApiRowData | null, e?: React.MouseEvent): void => {
			e?.stopPropagation();
			setLatencyModalRecord(record);
			setIsLatencyModalOpen(true);
		},
		[],
	);

	const closeLatencyModal = useCallback((): void => {
		setIsLatencyModalOpen(false);
		setLatencyModalRecord(null);
	}, []);

	// Navigate to trace explorer for a given operation and service
	const handleViewTraces = useCallback(
		(record: ReceivedApiRowData, e?: React.MouseEvent): void => {
			e?.stopPropagation();
			const startMs = minTime > 1e14 ? Math.floor(minTime / 1_000_000) : minTime;
			const endMs = maxTime > 1e14 ? Math.floor(maxTime / 1_000_000) : maxTime;

			const filterItems: TagFilterItem[] = [];
			const expressions: string[] = [];

			// 1. Service name filter
			if (record.serviceName && record.serviceName !== '-') {
				filterItems.push({
					id: uuid().slice(0, 8),
					key: {
						key: 'serviceName',
						dataType: DataTypes.String,
						type: 'tag',
						id: 'serviceName--string--tag--true',
					},
					op: 'in',
					value: [record.serviceName],
				});
				expressions.push(`serviceName in ['${record.serviceName}']`);
			}

			// 2. Operation name filter
			if (record.endpoint && record.endpoint !== '-') {
				filterItems.push({
					id: uuid().slice(0, 8),
					key: {
						key: 'name',
						dataType: DataTypes.String,
						type: 'tag',
						id: 'name--string--tag--true',
					},
					op: 'in',
					value: [record.endpoint],
				});
				expressions.push(`name in ['${record.endpoint}']`);
			}

			const filterExpression = expressions.join(' AND ');

			const tracesQuery: Query = {
				...initialQueriesMap.traces,
				builder: {
					...initialQueriesMap.traces.builder,
					queryData: [
						{
							...initialQueriesMap.traces.builder.queryData[0],
							dataSource: DataSource.TRACES,
							aggregateOperator: 'noop',
							disabled: false,
							filter: {
								expression: filterExpression,
							},
							filters: {
								op: 'AND',
								items: filterItems,
							},
						},
					],
				},
			};

			const urlParams = new URLSearchParams();
			urlParams.set(QueryParams.startTime, startMs.toString());
			urlParams.set(QueryParams.endTime, endMs.toString());
			urlParams.set(
				QueryParams.compositeQuery,
				encodeURIComponent(JSON.stringify(tracesQuery)),
			);
			urlParams.set(QueryParams.panelTypes, JSON.stringify(PANEL_TYPES.LIST));
			urlParams.set('selectedExplorerView', 'list');

			// Also set legacy selected param for backward compatibility
			const legacySelected = {
				serviceName: record.serviceName !== '-' ? [record.serviceName] : [],
				operation: [record.endpoint],
			};
			urlParams.set(
				'selected',
				encodeURIComponent(JSON.stringify(legacySelected)),
			);
			urlParams.set(
				'filterToFetchData',
				'["duration","status","serviceName","operation"]',
			);

			const tracesUrl = `${ROUTES.TRACES_EXPLORER}?${urlParams.toString()}`;

			logEvent('Received API Board: View traces clicked', {
				endpoint: record.endpoint,
				service: record.serviceName,
			});

			safeNavigate(tracesUrl);
		},
		[minTime, maxTime, safeNavigate],
	);

	const columns = useMemo(
		() => [
			{
				title: 'Status',
				dataIndex: 'status',
				key: 'status',
				width: '9%',
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
			},
			{
				title: 'API Request / Route',
				dataIndex: 'endpoint',
				key: 'endpoint',
				width: '28%',
				render: (endpoint: string): JSX.Element => (
					<div className="api-endpoint-cell">
						<Tooltip title="Configure status thresholds for this API">
							<Settings2
								size={14}
								className="settings-icon-btn"
								onClick={(e): void => {
									e.stopPropagation();
									openApiSettings(endpoint);
								}}
							/>
						</Tooltip>
						<span className="endpoint-text" title={endpoint}>
							{formatEndpointLabel(endpoint)}
						</span>
					</div>
				),
			},
			{
				title: 'Service',
				dataIndex: 'serviceName',
				key: 'serviceName',
				width: '14%',
				render: (serviceName: string): JSX.Element => (
					<Badge color="robin" className="service-badge">
						{serviceName}
					</Badge>
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
				width: '9%',
				align: 'right' as const,
				sorter: (a: ReceivedApiRowData, b: ReceivedApiRowData): number =>
					a.rate - b.rate,
			},
			{
				title: 'Total Requests',
				dataIndex: 'totalCount',
				key: 'totalCount',
				width: '11%',
				align: 'right' as const,
				sorter: (a: ReceivedApiRowData, b: ReceivedApiRowData): number =>
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
				width: '18%',
				sorter: (a: ReceivedApiRowData, b: ReceivedApiRowData): number =>
					a.errorRate - b.errorRate,
				render: (errorRate: number, record: ReceivedApiRowData): JSX.Element => {
					const warningRate = record.warningRate || 0;
					const successRate = record.successRate || 0;

					return (
						<div className="custom-progress-container">
							<div className="custom-progress-bar-wrapper">
								{errorRate > 0 && (
									<Tooltip
										title={`Error: ${errorRate.toFixed(2)}% (${record.errorCount} reqs)`}
									>
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
									<Tooltip
										title={`Warning: ${warningRate.toFixed(2)}% (${record.warningCount} reqs)`}
									>
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
							<div className="custom-progress-text">
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
				width: '11%',
				align: 'right' as const,
				sorter: (a: ReceivedApiRowData, b: ReceivedApiRowData): number =>
					a.latency - b.latency,
				render: (latency: number, record: ReceivedApiRowData): JSX.Element => (
					<Tooltip title="Click to view latency percentiles & graph">
						<span
							className="clickable-latency-cell"
							onClick={(e): void => openLatencyModal(record, e)}
						>
							<Activity size={12} style={{ color: 'var(--primary-background)' }} />
							{latency} ms
						</span>
					</Tooltip>
				),
			},
			{
				title: 'p99 Latency (ms)',
				dataIndex: 'p99Latency',
				key: 'p99Latency',
				width: '11%',
				align: 'right' as const,
				sorter: (a: ReceivedApiRowData, b: ReceivedApiRowData): number =>
					a.p99Latency - b.p99Latency,
				render: (p99Latency: number, record: ReceivedApiRowData): JSX.Element => (
					<Tooltip title="Click to view latency percentiles & graph">
						<span
							className="clickable-latency-cell"
							onClick={(e): void => openLatencyModal(record, e)}
						>
							{p99Latency} ms
						</span>
					</Tooltip>
				),
			},
			{
				title: 'Actions',
				key: 'actions',
				width: '9%',
				align: 'center' as const,
				render: (_: unknown, record: ReceivedApiRowData): JSX.Element => (
					<Button
						size="small"
						className="action-view-latency-btn"
						icon={<Activity size={12} />}
						onClick={(e): void => openLatencyModal(record, e)}
						title="View p50, p90, p95, p99, avg, max, min and latency graph"
					>
						Latency
					</Button>
				),
			},
		],
		[openApiSettings, handleViewTraces, openLatencyModal],
	);

	const tableData = receivedApisData || [];

	return (
		<div
			className={cx('api-monitoring-page', 'received-api-board-page', {
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
							<Button
								icon={<Activity size={14} />}
								onClick={(e): void => openLatencyModal(null, e)}
							>
								Latency Overview
							</Button>
						</div>
					}
					rightActions={
						<RightToolbarActions
							onStageRunQuery={handleStageAndRunQuery}
							isLoadingQueries={isFetching}
							handleCancelQuery={handleCancelQuery}
						/>
					}
				/>

				<div className="api-monitoring-list-header">
					<QuerySearch
						dataSource={DataSource.TRACES}
						queryData={query}
						onChange={handleSearchChange}
						placeholder="Filter received APIs (e.g. service.name = 'backend' AND deployment.environment = 'prod')"
						hardcodedAttributeKeys={ApiMonitoringHardcodedAttributeKeys}
					/>
				</div>

				<div className="api-board-content">
					{isCancelled && tableData.length === 0 && (
						<QueryCancelledPlaceholder subText='Click "Run Query" to load Received API data.' />
					)}

					{!isCancelled && !isFetching && !isLoading && tableData.length === 0 && (
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
								No Received API requests detected with applied filters.
							</div>
							<div style={{ color: 'var(--l2-foreground)', marginTop: 8 }}>
								Ensure your services emit server spans (kind: Server) with standard HTTP
								routes or operation names.
							</div>
						</div>
					)}

					{(isFetching || isLoading || tableData.length > 0) && (
						<Table
							className="api-monitoring-domain-list-table"
							dataSource={tableData}
							columns={columns}
							loading={{
								spinning: isLoading && tableData.length === 0,
								indicator: (
									<Spin indicator={<Loader size={16} className="animate-spin" />} />
								),
							}}
							pagination={{
								defaultPageSize: 20,
								showSizeChanger: true,
								pageSizeOptions: ['10', '20', '50', '100'],
								showTotal: (total, range): string =>
									`${range[0]}-${range[1]} of ${total} Received APIs`,
							}}
							onRow={(record): { onClick: () => void; className: string } => ({
								onClick: (): void => {
									handleViewTraces(record);
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

			{/* Modal for global threshold configuration */}
			<Modal
				title={
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<Settings size={16} style={{ color: 'var(--primary-background)' }} />
						<span>Configure Global Default Threshold Rules</span>
					</div>
				}
				open={isGlobalModalOpen}
				onCancel={(): void => setIsGlobalModalOpen(false)}
				onOk={(): void => globalForm.submit()}
				className="threshold-settings-modal"
				destroyOnClose
				width={560}
			>
				<Form
					form={globalForm}
					layout="vertical"
					initialValues={globalRule}
					onFinish={saveGlobalSettings}
				>
					<Form.Item
						name="errorCodes"
						label="Error Status Codes"
						rules={[{ required: true, message: 'Please specify error status codes' }]}
						extra="Comma-separated codes (e.g. 5xx,). Wildcards like 5xx supported. Trailing comma includes network/empty failures."
					>
						<Input placeholder="5xx," />
					</Form.Item>

					<Form.Item
						name="warningCodes"
						label="Warning Status Codes"
						rules={[
							{ required: true, message: 'Please specify warning status codes' },
						]}
						extra="Comma-separated codes (e.g. 4xx, 401, 403, 404). Wildcards supported."
					>
						<Input placeholder="4xx" />
					</Form.Item>

					<Form.Item
						name="successErrorRate"
						label="Success Error Rate Threshold (%)"
						extra="Maximum error rate (%) allowed to mark the API as Success."
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>

					<Form.Item
						name="warningErrorRate"
						label="Warning Error Rate Threshold (%)"
						rules={[
							({
								getFieldValue,
							}): { validator: (_: any, value: any) => Promise<void> } => ({
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
						extra="Maximum error rate (%) allowed for Warning. Above this threshold, status turns to Error."
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
				</Form>
			</Modal>

			{/* Modal for individual API threshold configuration */}
			<Modal
				title={
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<Settings2 size={16} style={{ color: 'var(--primary-background)' }} />
						<span>Configure API Threshold Rules</span>
					</div>
				}
				open={!!editingApi}
				onCancel={(): void => setEditingApi(null)}
				onOk={(): void => form.submit()}
				className="threshold-settings-modal"
				destroyOnClose
				width={560}
			>
				<div className="editing-api-banner">
					<span className="banner-label">API Route:</span>
					<code className="banner-code">{editingApi}</code>
				</div>
				<Form
					form={form}
					layout="vertical"
					initialValues={
						editingApi ? apiRules[editingApi] || globalRule : DEFAULT_GLOBAL_RULE
					}
					onFinish={saveApiSettings}
				>
					<Form.Item
						name="errorCodes"
						label="Error Status Codes"
						rules={[{ required: true, message: 'Please specify error status codes' }]}
						extra="Comma-separated codes (e.g. 5xx,). Support wildcards like 5xx. Leave trailing/leading comma to include empty/network failures."
					>
						<Input placeholder="5xx," />
					</Form.Item>

					<Form.Item
						name="warningCodes"
						label="Warning Status Codes"
						rules={[
							{ required: true, message: 'Please specify warning status codes' },
						]}
						extra="Comma-separated codes (e.g. 4xx). Support wildcards like 4xx."
					>
						<Input placeholder="4xx" />
					</Form.Item>

					<Form.Item
						name="successErrorRate"
						label="Success Error Rate Threshold (%)"
						extra="Maximum error rate allowed to mark this API as Success."
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>

					<Form.Item
						name="warningErrorRate"
						label="Warning Error Rate Threshold (%)"
						rules={[
							({
								getFieldValue,
							}): { validator: (_: any, value: any) => Promise<void> } => ({
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
						extra="Maximum error rate allowed to mark this API as Warning. Above this, the API is marked as Error."
					>
						<InputNumber min={0} max={100} style={{ width: '100%' }} />
					</Form.Item>
				</Form>
			</Modal>

			{/* Modal for latency percentiles and time-series graph */}
			<ReceivedApiLatencyModal
				open={isLatencyModalOpen}
				onClose={closeLatencyModal}
				record={latencyModalRecord}
				globalTimeRange={{ startTime: minTime, endTime: maxTime }}
				filterExpression={debouncedFilterExpression}
			/>
		</div>
	);
}

export default ReceivedApiPage;
