export interface LogScope {
	type: 'all' | 'specific';
	value?: string;
}

export interface ProjectPermissionRecord {
	project: string; // e.g., "customer-service", "All Projects"
	apm: 'read' | 'write' | 'none';
	traces: 'read' | 'write' | 'none';
	logs: 'read' | 'none';
	alerts: 'read' | 'write' | 'none';
	externalApi?: 'read' | 'none';
	logScope?: LogScope;
}

export function extractProjectPermissions(description: string): {
	cleanDescription: string;
	projectPermissions: ProjectPermissionRecord[];
} {
	if (!description) {
		return { cleanDescription: '', projectPermissions: [] };
	}
	const regex = /\[signoz_metadata:(.*)\]/;
	const match = description.match(regex);
	if (match && match[1]) {
		try {
			const parsed = JSON.parse(match[1]);
			const clean = description.replace(match[0], '').trim();
			const projectPermissions = (parsed.projectPermissions ?? []).map(
				(perm: ProjectPermissionRecord) => ({
					...perm,
					project: perm.project === 'All Projects' ? 'All Services' : perm.project,
				}),
			);
			return {
				cleanDescription: clean,
				projectPermissions,
			};
		} catch (e) {
			// fallback
		}
	}
	return { cleanDescription: description, projectPermissions: [] };
}

export function serializeProjectPermissions(
	cleanDescription: string,
	projectPermissions: ProjectPermissionRecord[],
): string {
	const desc = cleanDescription.trim();
	if (projectPermissions.length === 0) {
		return desc;
	}
	const metaStr = JSON.stringify({ projectPermissions });
	return `${desc} [signoz_metadata:${metaStr}]`;
}
