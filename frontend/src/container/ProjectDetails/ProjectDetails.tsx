import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { useParams } from 'react-router-dom';
import { useListUsers } from 'api/generated/services/users';
import { getProject } from 'api/v1/projects/list';
import {
	useAddProjectMember,
	useListProjectMembers,
	useRemoveProjectMember,
} from 'api/v1/projects/binding';
import { buildProjectUpdatePermission } from 'hooks/useAuthZ/permissions/project.permissions';
import type {
	Project,
	ProjectLogType,
	TelemetrySignal,
} from 'types/api/v1/projects';

import './ProjectDetails.styles.scss';

const SIGNALS: TelemetrySignal[] = ['logs', 'traces', 'metrics'];

const PROJECT_LOG_TYPES: ProjectLogType[] = [
	'application',
	'system',
	'audit',
	'access',
];

function ProjectDetails(): JSX.Element {
	const { projectId } = useParams<{ projectId: string }>();

	const projectQuery = useQuery({
		queryFn: () => getProject(projectId),
		queryKey: ['project', projectId],
		select: (res) => res?.data as Project | undefined,
		enabled: !!projectId,
	});

	const membersQuery = useListProjectMembers(projectId);

	const usersQuery = useListUsers();

	const project = projectQuery.data;
	const projectLogTypes = useMemo<ProjectLogType[]>(
		() => project?.logTypes ?? [],
		[project],
	);

	// Build a fast lookup: (userId, logType, signal) → boolean.
	// The server returns one row per (user, logType, signal) triple.
	const grants = useMemo(() => {
		const map = new Map<string, boolean>();
		for (const m of membersQuery.data ?? []) {
			map.set(`${m.userId}:${m.logType}:${m.signal}`, true);
		}
		return map;
	}, [membersQuery.data]);

	const addMember = useAddProjectMember(projectId).mutate;
	const removeMember = useRemoveProjectMember(projectId).mutate;

	const orgUsers = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);

	if (projectQuery.isLoading) {
		return <div className="project-details-empty">Loading project...</div>;
	}
	if (projectQuery.error || !project) {
		return <div className="project-details-empty">Project not found.</div>;
	}

	const toggleGrant = (
		userId: string,
		logType: ProjectLogType,
		signal: TelemetrySignal,
		shouldGrant: boolean,
	): void => {
		if (shouldGrant) {
			addMember({ userId, logType, signal });
		} else {
			removeMember({ userId, logType, signal });
		}
	};

	// We gate mutation on update permission at the route layer, but show
	// the page to all admins so they can see who has access.
	const updatePermission = buildProjectUpdatePermission(project.name);

	return (
		<div className="project-details" data-testid="project-details">
			<header className="project-details-header">
				<h3 className="project-details-title">{project.name}</h3>
				<p className="project-details-description">
					{project.description || 'No description.'}
				</p>
			</header>

			<section className="project-details-section">
				<h4>Member access</h4>
				<p className="project-details-help">
					Grant users read access to specific (log type × signal) combinations within
					this project. Admin role grants remain in effect.
				</p>

				<div
					className="project-details-table-wrapper"
					data-testid="project-details-table"
				>
					{membersQuery.isLoading || usersQuery.isLoading ? (
						<div className="project-details-empty">Loading members...</div>
					) : (
						<table className="project-details-table">
							<thead>
								<tr>
									<th>User</th>
									{PROJECT_LOG_TYPES.filter((lt) =>
										projectLogTypes.includes(lt),
									).flatMap((lt) =>
										SIGNALS.map((s) => (
											<th key={`${lt}-${s}`}>
												{lt} / {s}
											</th>
										)),
									)}
								</tr>
							</thead>
							<tbody>
								{orgUsers.length === 0 ? (
									<tr>
										<td
											colSpan={1 + projectLogTypes.length * SIGNALS.length}
											className="project-details-empty"
										>
											No users in this organization.
										</td>
									</tr>
								) : (
									orgUsers.map((u) => (
										<tr key={u.id} data-testid={`project-details-row-${u.id}`}>
											<td>
												<div className="project-details-user">
													<span className="project-details-user-name">
														{u.displayName || u.email}
													</span>
													{u.email && (
														<span className="project-details-user-email">{u.email}</span>
													)}
												</div>
											</td>
											{PROJECT_LOG_TYPES.filter((lt) =>
												projectLogTypes.includes(lt),
											).flatMap((lt) =>
												SIGNALS.map((s) => {
													const granted = grants.has(`${u.id}:${lt}:${s}`);
													return (
														<td key={`${u.id}-${lt}-${s}`}>
															<input
																type="checkbox"
																checked={granted}
																onChange={(): void => toggleGrant(u.id, lt, s, !granted)}
																aria-label={`${u.displayName} ${lt} ${s}`}
																data-testid={`project-details-toggle-${u.id}-${lt}-${s}`}
																data-permission={updatePermission}
															/>
														</td>
													);
												}),
											)}
										</tr>
									))
								)}
							</tbody>
						</table>
					)}
				</div>
			</section>
		</div>
	);
}

export default ProjectDetails;
