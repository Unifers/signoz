import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { listProjects } from 'api/v1/projects/list';
import {
	buildTelemetryLogTypeReadPermission,
	type TelemetrySignal,
} from 'hooks/useAuthZ/permissions/telemetryresource.permissions';
import { useAuthZ } from 'hooks/useAuthZ/useAuthZ';
import type { ProjectLogType } from 'types/api/v1/projects';

const SIGNALS: TelemetrySignal[] = ['logs', 'traces', 'metrics'];

// AccessibleProject is a (project, logType) tuple the user has read access
// to on at least one signal. The selector UI keys on this so each option
// represents an independent grantable unit.
export type AccessibleProject = {
	slug: string;
	logType: ProjectLogType;
	// signal the user has access on. Useful for diagnostic UIs; the
	// selector itself doesn't surface per-signal because the request
	// header carries only <slug>:<logType> and signal is per-request.
	grantedSignals: TelemetrySignal[];
};

export type UseAccessibleProjectsResult = {
	data: AccessibleProject[];
	isLoading: boolean;
};

export function useAccessibleProjects(): UseAccessibleProjectsResult {
	const projectsQuery = useQuery({
		queryFn: listProjects,
		queryKey: ['projects'],
		select: (res) => res?.data ?? [],
	});

	const projects = projectsQuery.data ?? [];

	// Flatten to (project × logType × signal) tuples so useAuthZ can batch
	// the permission checks. Dedupe is implicit because the source list
	// has no duplicates.
	const allTuples = useMemo(
		() =>
			projects.flatMap((p) =>
				p.logTypes.flatMap((lt) =>
					SIGNALS.map((s) => ({ slug: p.name, logType: lt, signal: s })),
				),
			),
		[projects],
	);

	const permissions = useAuthZ(
		allTuples.map((t) =>
			buildTelemetryLogTypeReadPermission(t.signal, t.slug, t.logType),
		),
		{ enabled: allTuples.length > 0 },
	);

	const accessible = useMemo<AccessibleProject[]>(() => {
		if (!permissions.permissions) {
			return [];
		}

		const grouped = new Map<string, AccessibleProject>();
		for (const t of allTuples) {
			const key = `${t.slug}:${t.logType}`;
			const granted =
				permissions.permissions[
					buildTelemetryLogTypeReadPermission(t.signal, t.slug, t.logType)
				]?.isGranted === true;
			if (!granted) {
				continue;
			}
			const existing = grouped.get(key);
			if (existing) {
				if (!existing.grantedSignals.includes(t.signal)) {
					existing.grantedSignals.push(t.signal);
				}
			} else {
				grouped.set(key, {
					slug: t.slug,
					logType: t.logType,
					grantedSignals: [t.signal],
				});
			}
		}

		// Sort alphabetically by slug, then by logType for deterministic
		// auto-selection on first load.
		return Array.from(grouped.values()).sort((a, b) => {
			if (a.slug !== b.slug) {
				return a.slug.localeCompare(b.slug);
			}
			return a.logType.localeCompare(b.logType);
		});
	}, [allTuples, permissions.permissions]);

	return {
		data: accessible,
		isLoading: projectsQuery.isLoading || permissions.isLoading,
	};
}
