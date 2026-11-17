import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from 'react-query';
import {
	Activity,
	Cpu,
	Database,
	HardDrive,
	RotateCw,
	Server,
	ShieldAlert,
	SolidAlertTriangle,
} from '@signozhq/icons';
import { Badge } from '@signozhq/ui/badge';
import { Button } from '@signozhq/ui/button';
import { Progress } from '@signozhq/ui/progress';
import { Typography } from '@signozhq/ui/typography';
import { Alert, Select, Space, Table, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import getHostMetrics from 'api/admin/getHostMetrics';
import { listHosts } from 'api/generated/services/inframonitoring';
import { InframonitoringtypesHostRecordDTO } from 'api/generated/services/sigNoz.schemas';
import Spinner from 'components/Spinner';
import { formatBytes } from 'container/InfraMonitoringK8sV2/commonUtils';
import dayjs from 'dayjs';
import { useAppContext } from 'providers/App/App';
import { DBDiskInfo, HostDiskUsage } from 'types/api/admin/hostMetrics';
import { USER_ROLES } from 'types/roles';

import './HostResources.styles.scss';

function getStatusColor(percent: number): {
	statusClass: string;
	progressColor: string;
	badgeVariant: 'outline' | 'default';
	badgeColor: 'forest' | 'amber' | 'cherry';
	label: string;
} {
	if (percent >= 85) {
		return {
			statusClass: 'status-critical',
			progressColor: '#ef4444',
			badgeVariant: 'default',
			badgeColor: 'cherry',
			label: 'Critical',
		};
	}
	if (percent >= 70) {
		return {
			statusClass: 'status-warning',
			progressColor: '#f59e0b',
			badgeVariant: 'outline',
			badgeColor: 'amber',
			label: 'Warning',
		};
	}
	return {
		statusClass: 'status-normal',
		progressColor: '#22c55e',
		badgeVariant: 'outline',
		badgeColor: 'forest',
		label: 'Optimal',
	};
}

function formatUptime(uptimeSeconds: number): string {
	if (!uptimeSeconds || uptimeSeconds <= 0) {
		return 'Just started';
	}
	const days = Math.floor(uptimeSeconds / 86400);
	const hours = Math.floor((uptimeSeconds % 86400) / 3600);
	const mins = Math.floor((uptimeSeconds % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days}d`);
	}
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	parts.push(`${mins}m`);
	return parts.join(' ');
}

export function HostResources(): JSX.Element {
	const { user } = useAppContext();
	const { t } = useTranslation(['common', 'routes']);
	const [refreshInterval, setRefreshInterval] = useState<number>(10000);

	const isAdmin = user?.role === USER_ROLES.ADMIN;

	const {
		data: hostMetricsResponse,
		isLoading,
		isRefetching,
		isError,
		error,
		refetch,
		dataUpdatedAt,
	} = useQuery(
		['adminHostMetrics', user?.accessJwt],
		async () => {
			const res = await getHostMetrics();
			if (res.error) {
				throw new Error(res.error);
			}
			return res.payload;
		},
		{
			enabled: isAdmin,
			refetchInterval: refreshInterval > 0 ? refreshInterval : false,
			refetchOnWindowFocus: true,
		},
	);

	// Also fetch monitored infrastructure hosts if available
	const { data: infraHostsData } = useQuery(
		['adminInfraHosts', user?.accessJwt],
		async () => {
			try {
				const now = Date.now();
				const res = await listHosts({
					start: now - 15 * 60 * 1000,
					end: now,
					offset: 0,
					limit: 10,
				});
				return res.data?.records || [];
			} catch {
				return [];
			}
		},
		{
			enabled: isAdmin,
			refetchInterval: refreshInterval > 0 ? refreshInterval : false,
		},
	);

	const handleRefresh = useCallback(() => {
		void refetch();
	}, [refetch]);

	if (!isAdmin) {
		return (
			<div className="host-resources-container">
				<div className="unauthorized-card">
					<div className="lock-icon">
						<ShieldAlert size={48} />
					</div>
					<div className="unauth-title">Access Restricted</div>
					<div className="unauth-desc">
						You need Administrator privileges to access Host Resources, Storage
						details, and CPU performance monitoring.
					</div>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="host-resources-container">
				<Spinner tip="Loading Host Storage & CPU metrics..." height="60vh" />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="host-resources-container">
				<Alert
					type="error"
					showIcon
					message="Failed to load host metrics"
					description={
						error instanceof Error ? error.message : t('something_went_wrong')
					}
					action={
						<Button size="sm" onClick={handleRefresh}>
							Retry
						</Button>
					}
				/>
			</div>
		);
	}

	const metrics = hostMetricsResponse;
	const storagePercent = metrics?.storageUsedPercent ?? 0;
	const cpuPercent = metrics?.cpu?.usagePercent ?? 0;
	const memPercent = metrics?.memory?.usedPercent ?? 0;

	const storageStatus = getStatusColor(storagePercent);
	const cpuStatus = getStatusColor(cpuPercent);
	const memStatus = getStatusColor(memPercent);

	const diskColumns: ColumnsType<HostDiskUsage> = [
		{
			title: 'Mount Point',
			dataIndex: 'mountpoint',
			key: 'mountpoint',
			render: (val: string): JSX.Element => (
				<Space>
					<HardDrive size={14} orientation="vertical" />
					<Typography.Text strong>{val}</Typography.Text>
				</Space>
			),
		},
		{
			title: 'Device',
			dataIndex: 'device',
			key: 'device',
			render: (val: string): JSX.Element => (
				<Typography.Text code>{val}</Typography.Text>
			),
		},
		{
			title: 'File System',
			dataIndex: 'fstype',
			key: 'fstype',
			render: (val: string): JSX.Element => (
				<Badge color="secondary" variant="outline">
					{val || 'local'}
				</Badge>
			),
		},
		{
			title: 'Total Space',
			dataIndex: 'totalBytes',
			key: 'totalBytes',
			render: (val: number): string => formatBytes(val),
		},
		{
			title: 'Used Space',
			dataIndex: 'usedBytes',
			key: 'usedBytes',
			render: (val: number): string => formatBytes(val),
		},
		{
			title: 'Free Space',
			dataIndex: 'freeBytes',
			key: 'freeBytes',
			render: (val: number): string => formatBytes(val),
		},
		{
			title: 'Storage Usage',
			dataIndex: 'usedPercent',
			key: 'usedPercent',
			width: 220,
			render: (percent: number): JSX.Element => {
				const status = getStatusColor(percent);
				return (
					<div className="storage-table-progress">
						<div className="progress-bar-wrap">
							<Progress
								percent={percent}
								showInfo={false}
								strokeColor={status.progressColor}
							/>
						</div>
						<span className="percent-text" style={{ color: status.progressColor }}>
							{percent.toFixed(1)}%
						</span>
					</div>
				);
			},
		},
		{
			title: 'Status',
			key: 'status',
			render: (_: unknown, record: HostDiskUsage): JSX.Element => {
				const status = getStatusColor(record.usedPercent);
				return (
					<Badge color={status.badgeColor} variant={status.badgeVariant}>
						{status.label}
					</Badge>
				);
			},
		},
	];

	const dbDiskColumns: ColumnsType<DBDiskInfo> = [
		{
			title: 'Disk Name',
			dataIndex: 'name',
			key: 'name',
			render: (val: string): JSX.Element => (
				<Space>
					<Database size={14} />
					<Typography.Text strong>{val}</Typography.Text>
				</Space>
			),
		},
		{
			title: 'Type',
			dataIndex: 'type',
			key: 'type',
			render: (val: string): JSX.Element => (
				<Badge color="robin" variant="outline">
					{val}
				</Badge>
			),
		},
		{
			title: 'Path',
			dataIndex: 'path',
			key: 'path',
			render: (val: string): JSX.Element => (
				<Typography.Text code>{val || '-'}</Typography.Text>
			),
		},
		{
			title: 'Total Space',
			dataIndex: 'totalSpace',
			key: 'totalSpace',
			render: (val: number): string => (val > 0 ? formatBytes(val) : '-'),
		},
		{
			title: 'Free Space',
			dataIndex: 'freeSpace',
			key: 'freeSpace',
			render: (val: number): string => (val > 0 ? formatBytes(val) : '-'),
		},
		{
			title: 'Used Space',
			key: 'usedSpace',
			render: (_: unknown, record: DBDiskInfo): string => {
				if (record.totalSpace > 0 && record.totalSpace >= record.freeSpace) {
					return formatBytes(record.totalSpace - record.freeSpace);
				}
				return '-';
			},
		},
	];

	const infraHostColumns: ColumnsType<InframonitoringtypesHostRecordDTO> = [
		{
			title: 'Host Name',
			dataIndex: 'hostName',
			key: 'hostName',
			render: (val: string): JSX.Element => (
				<Space>
					<Server size={14} />
					<Typography.Text strong>{val || 'unknown'}</Typography.Text>
				</Space>
			),
		},
		{
			title: 'Status',
			dataIndex: 'status',
			key: 'status',
			render: (status: string): JSX.Element => (
				<Badge
					color={status === 'active' ? 'forest' : 'secondary'}
					variant="outline"
				>
					{status ? status.toUpperCase() : 'UNKNOWN'}
				</Badge>
			),
		},
		{
			title: 'CPU Usage',
			dataIndex: 'cpu',
			key: 'cpu',
			render: (val: number): JSX.Element => {
				const pct = val >= 0 ? val * 100 : 0;
				const status = getStatusColor(pct);
				return (
					<div className="storage-table-progress">
						<div className="progress-bar-wrap">
							<Progress
								percent={pct}
								showInfo={false}
								strokeColor={status.progressColor}
							/>
						</div>
						<span className="percent-text" style={{ color: status.progressColor }}>
							{pct.toFixed(1)}%
						</span>
					</div>
				);
			},
		},
		{
			title: 'Memory Usage',
			dataIndex: 'memory',
			key: 'memory',
			render: (val: number): JSX.Element => {
				const pct = val >= 0 ? val * 100 : 0;
				const status = getStatusColor(pct);
				return (
					<div className="storage-table-progress">
						<div className="progress-bar-wrap">
							<Progress
								percent={pct}
								showInfo={false}
								strokeColor={status.progressColor}
							/>
						</div>
						<span className="percent-text" style={{ color: status.progressColor }}>
							{pct.toFixed(1)}%
						</span>
					</div>
				);
			},
		},
		{
			title: 'Disk Usage',
			dataIndex: 'diskUsage',
			key: 'diskUsage',
			render: (val: number): JSX.Element => {
				const pct = val >= 0 ? val * 100 : 0;
				const status = getStatusColor(pct);
				return (
					<div className="storage-table-progress">
						<div className="progress-bar-wrap">
							<Progress
								percent={pct}
								showInfo={false}
								strokeColor={status.progressColor}
							/>
						</div>
						<span className="percent-text" style={{ color: status.progressColor }}>
							{pct.toFixed(1)}%
						</span>
					</div>
				);
			},
		},
		{
			title: 'Load Avg (15m)',
			dataIndex: 'load15',
			key: 'load15',
			render: (val: number): string => (val >= 0 ? val.toFixed(2) : '-'),
		},
	];

	return (
		<div className="host-resources-container">
			{/* Header Section */}
			<div className="header-section">
				<div className="header-title-container">
					<div className="header-title">
						<HardDrive size={20} />
						Host Storage & CPU Resources
					</div>
					<div className="header-subtitle">
						Current host storage capacity, disk usage, and real-time CPU & system
						performance
					</div>
				</div>

				<div className="header-actions">
					{dataUpdatedAt > 0 && (
						<span className="refresh-info">
							Updated {dayjs(dataUpdatedAt).format('HH:mm:ss')}
						</span>
					)}
					<Select
						size="small"
						value={refreshInterval}
						onChange={(val): void => setRefreshInterval(val)}
						style={{ width: 120 }}
						options={[
							{ label: 'Auto: Off', value: 0 },
							{ label: 'Auto: 5s', value: 5000 },
							{ label: 'Auto: 10s', value: 10000 },
							{ label: 'Auto: 30s', value: 30000 },
							{ label: 'Auto: 60s', value: 60000 },
						]}
					/>
					<Button
						size="sm"
						variant="outlined"
						onClick={handleRefresh}
						disabled={isRefetching}
					>
						<RotateCw
							size={14}
							style={{ marginRight: '6px' }}
							className={isRefetching ? 'animate-spin' : ''}
						/>
						Refresh
					</Button>
				</div>
			</div>

			{/* Top Metric Summary Cards */}
			<div className="summary-cards-grid">
				{/* 1. Host Storage Card */}
				<div className="summary-card">
					<div className="card-header">
						<div className="card-title-group">
							<div className="card-icon">
								<HardDrive size={18} />
							</div>
							<div className="card-title">Host Storage Usage</div>
						</div>
						<Badge
							color={storageStatus.badgeColor}
							variant={storageStatus.badgeVariant}
						>
							{storageStatus.label}
						</Badge>
					</div>

					<div className="card-main-metric">
						<span className={`metric-value ${storageStatus.statusClass}`}>
							{storagePercent.toFixed(1)}%
						</span>
						<span className="metric-subtext">Used of total capacity</span>
					</div>

					<div className="card-progress">
						<Progress
							percent={storagePercent}
							showInfo={false}
							strokeColor={storageStatus.progressColor}
						/>
					</div>

					<div className="card-footer-stats">
						<div className="footer-stat-item">
							<span className="stat-label">Total</span>
							<span className="stat-val">
								{formatBytes(metrics?.totalStorageBytes ?? 0)}
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Used</span>
							<span className="stat-val">
								{formatBytes(metrics?.usedStorageBytes ?? 0)}
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Free</span>
							<span className="stat-val">
								{formatBytes(metrics?.freeStorageBytes ?? 0)}
							</span>
						</div>
					</div>
				</div>

				{/* 2. CPU Usage Card */}
				<div className="summary-card">
					<div className="card-header">
						<div className="card-title-group">
							<div className="card-icon">
								<Cpu size={18} />
							</div>
							<div className="card-title">Host CPU Usage</div>
						</div>
						<Badge color={cpuStatus.badgeColor} variant={cpuStatus.badgeVariant}>
							{cpuStatus.label}
						</Badge>
					</div>

					<div className="card-main-metric">
						<span className={`metric-value ${cpuStatus.statusClass}`}>
							{cpuPercent.toFixed(1)}%
						</span>
						<span className="metric-subtext">Current CPU load</span>
					</div>

					<div className="card-progress">
						<Progress
							percent={cpuPercent}
							showInfo={false}
							strokeColor={cpuStatus.progressColor}
						/>
					</div>

					<div className="card-footer-stats">
						<div className="footer-stat-item">
							<span className="stat-label">Cores</span>
							<span className="stat-val">
								{metrics?.cpu?.coresLogical ?? 1} ({metrics?.cpu?.coresPhysical ?? 1}{' '}
								phys)
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Load (1m)</span>
							<span className="stat-val">
								{metrics?.cpu?.load1?.toFixed(2) ?? '0.00'}
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Load (15m)</span>
							<span className="stat-val">
								{metrics?.cpu?.load15?.toFixed(2) ?? '0.00'}
							</span>
						</div>
					</div>
				</div>

				{/* 3. Memory Card */}
				<div className="summary-card">
					<div className="card-header">
						<div className="card-title-group">
							<div className="card-icon">
								<Activity size={18} />
							</div>
							<div className="card-title">Memory (RAM)</div>
						</div>
						<Badge color={memStatus.badgeColor} variant={memStatus.badgeVariant}>
							{memStatus.label}
						</Badge>
					</div>

					<div className="card-main-metric">
						<span className={`metric-value ${memStatus.statusClass}`}>
							{memPercent.toFixed(1)}%
						</span>
						<span className="metric-subtext">RAM utilized</span>
					</div>

					<div className="card-progress">
						<Progress
							percent={memPercent}
							showInfo={false}
							strokeColor={memStatus.progressColor}
						/>
					</div>

					<div className="card-footer-stats">
						<div className="footer-stat-item">
							<span className="stat-label">Total</span>
							<span className="stat-val">
								{formatBytes(metrics?.memory?.totalBytes ?? 0)}
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Used</span>
							<span className="stat-val">
								{formatBytes(metrics?.memory?.usedBytes ?? 0)}
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Free</span>
							<span className="stat-val">
								{formatBytes(metrics?.memory?.freeBytes ?? 0)}
							</span>
						</div>
					</div>
				</div>

				{/* 4. Host Info Card */}
				<div className="summary-card">
					<div className="card-header">
						<div className="card-title-group">
							<div className="card-icon">
								<Server size={18} />
							</div>
							<div className="card-title">Host Information</div>
						</div>
						<Badge color="forest" variant="outline">
							Online
						</Badge>
					</div>

					<div className="card-main-metric">
						<span
							className="metric-value status-normal"
							style={{ fontSize: 20, wordBreak: 'break-all' }}
						>
							{metrics?.system?.hostname || 'localhost'}
						</span>
					</div>

					<div className="card-progress" style={{ visibility: 'hidden' }}>
						<Progress percent={100} showInfo={false} />
					</div>

					<div className="card-footer-stats">
						<div className="footer-stat-item">
							<span className="stat-label">OS / Platform</span>
							<span className="stat-val">
								{metrics?.system?.os || '-'} ({metrics?.system?.platform || '-'})
							</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Architecture</span>
							<span className="stat-val">{metrics?.system?.kernelArch || '-'}</span>
						</div>
						<div className="footer-stat-item">
							<span className="stat-label">Uptime</span>
							<span className="stat-val">
								{formatUptime(metrics?.system?.uptime ?? 0)}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Detailed Views Tabs */}
			<div className="details-tabs-card">
				<Tabs
					defaultActiveKey="storage"
					items={[
						{
							key: 'storage',
							label: (
								<Space>
									<HardDrive size={15} />
									<span>Host Storage & Filesystems ({metrics?.disks?.length ?? 0})</span>
								</Space>
							),
							children: (
								<Space direction="vertical" style={{ width: '100%' }} size="large">
									<Table
										rowKey={(record): string => `${record.device}-${record.mountpoint}`}
										columns={diskColumns}
										dataSource={metrics?.disks || []}
										pagination={false}
										locale={{ emptyText: 'No disk partitions found' }}
									/>

									{metrics?.databaseDisks && metrics.databaseDisks.length > 0 && (
										<div>
											<div
												style={{
													fontSize: 14,
													fontWeight: 600,
													color: 'var(--text-ink-400, #cbd5e1)',
													marginBottom: 12,
													display: 'flex',
													alignItems: 'center',
													gap: 8,
												}}
											>
												<Database size={16} />
												<span>Database Storage Disks (ClickHouse)</span>
											</div>
											<Table
												rowKey="name"
												columns={dbDiskColumns}
												dataSource={metrics.databaseDisks}
												pagination={false}
											/>
										</div>
									)}
								</Space>
							),
						},
						{
							key: 'cpu',
							label: (
								<Space>
									<Cpu size={15} />
									<span>CPU & Performance Breakdown</span>
								</Space>
							),
							children: (
								<div className="cpu-breakdown-section">
									<div className="cpu-specs-grid">
										<div className="spec-box">
											<div className="spec-label">Processor Model</div>
											<div className="spec-value">
												{metrics?.cpu?.modelName || 'Host CPU'}
											</div>
										</div>
										<div className="spec-box">
											<div className="spec-label">Logical Cores</div>
											<div className="spec-value">
												{metrics?.cpu?.coresLogical ?? 1} Threads
											</div>
										</div>
										<div className="spec-box">
											<div className="spec-label">Physical Cores</div>
											<div className="spec-value">
												{metrics?.cpu?.coresPhysical ?? 1} Cores
											</div>
										</div>
										<div className="spec-box">
											<div className="spec-label">Load Average (1m / 5m / 15m)</div>
											<div className="spec-value">
												{metrics?.cpu?.load1?.toFixed(2) ?? '0.00'} /{' '}
												{metrics?.cpu?.load5?.toFixed(2) ?? '0.00'} /{' '}
												{metrics?.cpu?.load15?.toFixed(2) ?? '0.00'}
											</div>
										</div>
									</div>

									{metrics?.cpu?.perCoreUsage && metrics.cpu.perCoreUsage.length > 0 && (
										<div>
											<div className="cores-grid-title">Per-Core CPU Utilization</div>
											<div className="per-core-grid">
												{metrics.cpu.perCoreUsage
													.map((usage, index) => ({ id: `core-${index}`, usage, index }))
													.map((core) => {
														const status = getStatusColor(core.usage);
														return (
															<div key={core.id} className="core-box">
																<div className="core-header">
																	<span>Core {core.index}</span>
																	<span style={{ color: status.progressColor }}>
																		{core.usage.toFixed(1)}%
																	</span>
																</div>
																<Progress
																	percent={core.usage}
																	showInfo={false}
																	strokeColor={status.progressColor}
																	size="small"
																/>
															</div>
														);
													})}
											</div>
										</div>
									)}
								</div>
							),
						},
						{
							key: 'monitored-hosts',
							label: (
								<Space>
									<Server size={15} />
									<span>Monitored Hosts ({infraHostsData?.length ?? 0})</span>
								</Space>
							),
							children: (
								<Space direction="vertical" style={{ width: '100%' }} size="middle">
									{!infraHostsData || infraHostsData.length === 0 ? (
										<Alert
											type="info"
											showIcon
											icon={<SolidAlertTriangle size={16} />}
											message="No external infrastructure hosts currently sending metrics"
											description="To stream hostmetrics from additional servers, install the SigNoz OpenTelemetry Collector hostmetrics receiver on your hosts."
										/>
									) : (
										<Table
											rowKey={(record): string => record.hostName || 'unknown'}
											columns={infraHostColumns}
											dataSource={infraHostsData}
											pagination={false}
										/>
									)}
								</Space>
							),
						},
					]}
				/>
			</div>
		</div>
	);
}

export default HostResources;
