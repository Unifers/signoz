export interface HostDiskUsage {
	device: string;
	mountpoint: string;
	fstype: string;
	totalBytes: number;
	usedBytes: number;
	freeBytes: number;
	usedPercent: number;
}

export interface HostCPUInfo {
	usagePercent: number;
	coresLogical: number;
	coresPhysical: number;
	modelName?: string;
	load1: number;
	load5: number;
	load15: number;
	perCoreUsage?: number[];
}

export interface HostMemoryInfo {
	totalBytes: number;
	usedBytes: number;
	freeBytes: number;
	usedPercent: number;
}

export interface HostSystemInfo {
	hostname: string;
	os: string;
	platform: string;
	platformVersion: string;
	kernelArch: string;
	uptime: number;
}

export interface DBDiskInfo {
	name: string;
	type: string;
	path: string;
	freeSpace: number;
	totalSpace: number;
}

export interface AdminHostMetricsResponse {
	system: HostSystemInfo;
	cpu: HostCPUInfo;
	memory: HostMemoryInfo;
	disks: HostDiskUsage[];
	databaseDisks?: DBDiskInfo[];
	totalStorageBytes: number;
	usedStorageBytes: number;
	freeStorageBytes: number;
	storageUsedPercent: number;
}
