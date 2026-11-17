package app

import (
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
)

type HostDiskUsage struct {
	Device      string  `json:"device"`
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	TotalBytes  uint64  `json:"totalBytes"`
	UsedBytes   uint64  `json:"usedBytes"`
	FreeBytes   uint64  `json:"freeBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

type HostCPUInfo struct {
	UsagePercent  float64   `json:"usagePercent"`
	CoresLogical  int       `json:"coresLogical"`
	CoresPhysical int       `json:"coresPhysical"`
	ModelName     string    `json:"modelName,omitempty"`
	Load1         float64   `json:"load1"`
	Load5         float64   `json:"load5"`
	Load15        float64   `json:"load15"`
	PerCoreUsage  []float64 `json:"perCoreUsage,omitempty"`
}

type HostMemoryInfo struct {
	TotalBytes  uint64  `json:"totalBytes"`
	UsedBytes   uint64  `json:"usedBytes"`
	FreeBytes   uint64  `json:"freeBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

type HostSystemInfo struct {
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	Platform        string `json:"platform"`
	PlatformVersion string `json:"platformVersion"`
	KernelArch      string `json:"kernelArch"`
	Uptime          uint64 `json:"uptime"`
}

type DBDiskInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Path       string `json:"path"`
	FreeSpace  uint64 `json:"freeSpace"`
	TotalSpace uint64 `json:"totalSpace"`
}

type AdminHostMetricsResponse struct {
	System             HostSystemInfo  `json:"system"`
	CPU                HostCPUInfo     `json:"cpu"`
	Memory             HostMemoryInfo  `json:"memory"`
	Disks              []HostDiskUsage `json:"disks"`
	DatabaseDisks      []DBDiskInfo    `json:"databaseDisks,omitempty"`
	TotalStorageBytes  uint64          `json:"totalStorageBytes"`
	UsedStorageBytes   uint64          `json:"usedStorageBytes"`
	FreeStorageBytes   uint64          `json:"freeStorageBytes"`
	StorageUsedPercent float64         `json:"storageUsedPercent"`
}

func round2(val float64) float64 {
	return math.Round(val*100) / 100
}

func isIgnoredFSType(fstype string) bool {
	ignored := map[string]bool{
		"tmpfs":       true,
		"devtmpfs":    true,
		"squashfs":    true,
		"iso9660":     true,
		"overlay":     true,
		"shm":         true,
		"proc":        true,
		"sysfs":       true,
		"cgroup":      true,
		"cgroup2":     true,
		"autofs":      true,
		"pstore":      true,
		"securityfs":  true,
		"debugfs":     true,
		"tracefs":     true,
		"configfs":    true,
		"fusectl":     true,
		"binfmt_misc": true,
		"mqueue":      true,
		"hugetlbfs":   true,
		"devpts":      true,
	}
	return ignored[strings.ToLower(fstype)]
}

func (aH *APIHandler) getHostMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	res := AdminHostMetricsResponse{
		Disks:         make([]HostDiskUsage, 0),
		DatabaseDisks: make([]DBDiskInfo, 0),
	}

	// 1. Host System Info
	if hInfo, err := host.InfoWithContext(ctx); err == nil && hInfo != nil {
		res.System = HostSystemInfo{
			Hostname:        hInfo.Hostname,
			OS:              hInfo.OS,
			Platform:        hInfo.Platform,
			PlatformVersion: hInfo.PlatformVersion,
			KernelArch:      hInfo.KernelArch,
			Uptime:          hInfo.Uptime,
		}
	}

	// 2. CPU Info
	cpuPercents, err := cpu.PercentWithContext(ctx, 150*time.Millisecond, false)
	if err == nil && len(cpuPercents) > 0 {
		res.CPU.UsagePercent = round2(cpuPercents[0])
	}
	if perCore, err := cpu.PercentWithContext(ctx, 0, true); err == nil && len(perCore) > 0 {
		roundedCores := make([]float64, len(perCore))
		for i, c := range perCore {
			roundedCores[i] = round2(c)
		}
		res.CPU.PerCoreUsage = roundedCores
	}
	if lCount, err := cpu.CountsWithContext(ctx, true); err == nil {
		res.CPU.CoresLogical = lCount
	}
	if pCount, err := cpu.CountsWithContext(ctx, false); err == nil {
		res.CPU.CoresPhysical = pCount
	}
	if cpuInfos, err := cpu.InfoWithContext(ctx); err == nil && len(cpuInfos) > 0 {
		res.CPU.ModelName = cpuInfos[0].ModelName
	}
	if lAvg, err := load.AvgWithContext(ctx); err == nil && lAvg != nil {
		res.CPU.Load1 = round2(lAvg.Load1)
		res.CPU.Load5 = round2(lAvg.Load5)
		res.CPU.Load15 = round2(lAvg.Load15)
	}

	// 3. Memory Info
	if vmem, err := mem.VirtualMemoryWithContext(ctx); err == nil && vmem != nil {
		res.Memory = HostMemoryInfo{
			TotalBytes:  vmem.Total,
			UsedBytes:   vmem.Used,
			FreeBytes:   vmem.Available,
			UsedPercent: round2(vmem.UsedPercent),
		}
	}

	// 4. Host Disks / Storage Info
	partitions, err := disk.PartitionsWithContext(ctx, false)
	if err == nil {
		seenMounts := make(map[string]bool)
		seenDevices := make(map[string]bool)

		for _, p := range partitions {
			if isIgnoredFSType(p.Fstype) {
				continue
			}
			if strings.HasPrefix(p.Mountpoint, "/dev") ||
				strings.HasPrefix(p.Mountpoint, "/proc") ||
				strings.HasPrefix(p.Mountpoint, "/sys") {
				continue
			}
			if seenMounts[p.Mountpoint] {
				continue
			}
			seenMounts[p.Mountpoint] = true

			usage, err := disk.UsageWithContext(ctx, p.Mountpoint)
			if err != nil || usage == nil || usage.Total == 0 {
				continue
			}

			diskItem := HostDiskUsage{
				Device:      p.Device,
				Mountpoint:  p.Mountpoint,
				Fstype:      p.Fstype,
				TotalBytes:  usage.Total,
				UsedBytes:   usage.Used,
				FreeBytes:   usage.Free,
				UsedPercent: round2(usage.UsedPercent),
			}
			res.Disks = append(res.Disks, diskItem)

			// Aggregate overall storage across unique devices to prevent duplicate counts
			if !seenDevices[p.Device] {
				seenDevices[p.Device] = true
				res.TotalStorageBytes += usage.Total
				res.UsedStorageBytes += usage.Used
				res.FreeStorageBytes += usage.Free
			}
		}

		if res.TotalStorageBytes > 0 {
			res.StorageUsedPercent = round2((float64(res.UsedStorageBytes) / float64(res.TotalStorageBytes)) * 100)
		}
	}

	// 5. Database Disks (from ClickHouse if accessible)
	if aH.reader != nil {
		if dbDisks, apiErr := aH.reader.GetDisks(ctx); apiErr == nil && dbDisks != nil {
			for _, d := range *dbDisks {
				res.DatabaseDisks = append(res.DatabaseDisks, DBDiskInfo{
					Name:       d.Name,
					Type:       d.Type,
					Path:       d.Path,
					FreeSpace:  d.FreeSpace,
					TotalSpace: d.TotalSpace,
				})
			}
		}
	}

	aH.WriteJSON(w, r, res)
}
