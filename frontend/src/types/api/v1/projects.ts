// Wire types for the /api/v1/projects endpoints. Kept minimal and
// hand-written until the orval generator picks them up; mirror the
// backend `pkg/types/project.go` definitions.

export type ProjectLogType = 'application' | 'system' | 'audit' | 'access';

export type TelemetrySignal = 'logs' | 'traces' | 'metrics';

export type Project = {
	id: string;
	name: string;
	description: string;
	orgId: string;
	logTypes: ProjectLogType[];
	createdBy: string;
	createdAt: string;
	updatedAt: string;
};

export type PostableProject = {
	name: string;
	description: string;
	logTypes: ProjectLogType[];
};

export type UpdatableProject = {
	description?: string;
	logTypes?: ProjectLogType[];
};

// ProjectMember is the response shape for listing users with access to a
// project. Each entry is denormalized — one row per (user, signal, logType)
// tuple — so the binding UI can render a grid without further expansion.
export type ProjectMember = {
	userId: string;
	email: string;
	displayName: string;
	logType: ProjectLogType;
	signal: TelemetrySignal;
};

// PostableProjectMember is the request body for granting a user access to
// a single (project, signal, logType) tuple.
export type PostableProjectMember = {
	userId: string;
	logType: ProjectLogType;
	signal: TelemetrySignal;
};
