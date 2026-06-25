import { buildPermission } from '../utils';
import type { BrandedPermission } from '../types';
import type { ProjectLogType } from './project.permissions';

// Read-only telemetryresource permissions. The kind segment of the object
// string is the telemetry signal (logs, traces, metrics) and the selector
// segment is the composed "<projectSlug>/<logType>" pair.
//
// Examples:
//   buildTelemetryReadPermission('logs', 'frontend-app')
//     -> "read||__||logs:frontend-app"
//   buildTelemetryLogTypeReadPermission('logs', 'frontend-app', 'application')
//     -> "read||__||logs:frontend-app/application"
//
// The backend's `ProjectLogTypeSelector` parses the per-signal id
// "<projectSlug>:<signal>:<logType>" into a composed selector
// "<projectSlug>/<logType>" plus the wildcard fallback. The selector
// string sent over the wire uses "/" so it matches the FGA tuple format
// the binding service writes.

export type TelemetrySignal = 'logs' | 'traces' | 'metrics';

export const buildTelemetryReadPermission = (
	signal: TelemetrySignal,
	projectSlug: string,
): BrandedPermission => buildPermission('read', `${signal}:${projectSlug}`);

export const buildTelemetryLogTypeReadPermission = (
	signal: TelemetrySignal,
	projectSlug: string,
	logType: ProjectLogType,
): BrandedPermission =>
	buildPermission('read', `${signal}:${projectSlug}/${logType}`);
