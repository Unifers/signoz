import { buildPermission } from '../utils';
import type { BrandedPermission } from '../types';

// Project Access — per-project, per-log-type read permissions.
// Mirrors the backend `pkg/types/coretypes/TypeProject` and
// `pkg/types/coretypes/ProjectLogTypeSelector` model.

export const PROJECT_LOG_TYPES = [
	'application',
	'system',
	'audit',
	'access',
] as const;

export type ProjectLogType = (typeof PROJECT_LOG_TYPES)[number];

// Collection-level — admin-only operations on the project entity itself.
export const ProjectCreatePermission = buildPermission('create', 'project:*');
export const ProjectListPermission = buildPermission('list', 'project:*');

// Resource-level — require a specific project id (slug).
export const buildProjectReadPermission = (slug: string): BrandedPermission =>
	buildPermission('read', `project:${slug}`);
export const buildProjectUpdatePermission = (slug: string): BrandedPermission =>
	buildPermission('update', `project:${slug}`);
export const buildProjectDeletePermission = (slug: string): BrandedPermission =>
	buildPermission('delete', `project:${slug}`);

// Per-(project, logType) read permission for telemetry data. The selector
// format "<slug>/<logType>" (with a slash) matches the backend
// `ProjectLogTypeSelector` and the FGA tuple format used by
// `pkg/modules/project/implproject/binding.go`. The `logs` kind is the
// canonical telemetry resource for log data — the authz middleware also
// checks traces and metrics variants on the v5 query endpoint based on
// the request body's `spec.signal`.
export const buildProjectLogTypeReadPermission = (
	slug: string,
	logType: ProjectLogType,
): BrandedPermission => buildPermission('read', `logs:${slug}/${logType}`);
