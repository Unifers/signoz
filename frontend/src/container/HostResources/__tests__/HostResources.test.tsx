import { HostResources } from 'container/HostResources/HostResources';
import { render, screen, waitFor } from 'tests/test-utils';
import { USER_ROLES } from 'types/roles';

const mockHostMetrics = {
	system: {
		hostname: 'test-host-01',
		os: 'linux',
		platform: 'ubuntu',
		platformVersion: '22.04',
		kernelArch: 'x86_64',
		uptime: 360000,
	},
	cpu: {
		usagePercent: 35.5,
		coresLogical: 8,
		coresPhysical: 4,
		modelName: 'Intel Core i7-9750H',
		load1: 1.25,
		load5: 1.15,
		load15: 0.95,
		perCoreUsage: [30.1, 40.2, 25.0, 38.4],
	},
	memory: {
		totalBytes: 17179869184, // 16 GB
		usedBytes: 8589934592, // 8 GB
		freeBytes: 8589934592, // 8 GB
		usedPercent: 50.0,
	},
	disks: [
		{
			device: '/dev/sda1',
			mountpoint: '/',
			fstype: 'ext4',
			totalBytes: 107374182400, // 100 GB
			usedBytes: 42949672960, // 40 GB
			freeBytes: 64424509440, // 60 GB
			usedPercent: 40.0,
		},
	],
	databaseDisks: [
		{
			name: 'default',
			type: 'local',
			path: '/var/lib/clickhouse/',
			freeSpace: 64424509440,
			totalSpace: 107374182400,
		},
	],
	totalStorageBytes: 107374182400,
	usedStorageBytes: 42949672960,
	freeStorageBytes: 64424509440,
	storageUsedPercent: 40.0,
};

jest.mock('api/admin/getHostMetrics', () => ({
	__esModule: true,
	default: jest.fn(() =>
		Promise.resolve({
			statusCode: 200,
			error: null,
			message: 'Success',
			payload: mockHostMetrics,
		}),
	),
	getHostMetrics: jest.fn(() =>
		Promise.resolve({
			statusCode: 200,
			error: null,
			message: 'Success',
			payload: mockHostMetrics,
		}),
	),
}));

jest.mock('api/generated/services/inframonitoring', () => ({
	listHosts: jest.fn(() =>
		Promise.resolve({
			data: {
				records: [],
				total: 0,
			},
		}),
	),
}));

describe('HostResources Component', () => {
	it('renders access restricted message for non-admin users', () => {
		render(<HostResources />, undefined, {
			role: USER_ROLES.VIEWER,
		});

		expect(screen.getByText('Access Restricted')).toBeInTheDocument();
		expect(
			screen.getByText(
				/You need Administrator privileges to access Host Resources/i,
			),
		).toBeInTheDocument();
	});

	it('renders host storage and CPU metrics for admin users', async () => {
		render(<HostResources />, undefined, {
			role: USER_ROLES.ADMIN,
		});

		// Wait for data to load
		await waitFor(() => {
			expect(screen.getByText('test-host-01')).toBeInTheDocument();
		});

		// Header is rendered
		expect(screen.getByText('Host Storage & CPU Resources')).toBeInTheDocument();

		// Storage metrics rendered
		expect(screen.getByText('Host Storage Usage')).toBeInTheDocument();
		expect(screen.getAllByText('40.0%').length).toBeGreaterThanOrEqual(1);

		// CPU metrics rendered
		expect(screen.getByText('Host CPU Usage')).toBeInTheDocument();
		expect(screen.getByText('35.5%')).toBeInTheDocument();

		// Disk partition in table
		expect(screen.getByText('/')).toBeInTheDocument();
		expect(screen.getByText('/dev/sda1')).toBeInTheDocument();
	});
});
