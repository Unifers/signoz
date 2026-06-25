import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { Plus, Trash2 } from '@signozhq/icons';
import { Button } from '@signozhq/ui/button';
import { Input } from '@signozhq/ui/input';
import AuthZTooltip from 'components/AuthZTooltip/AuthZTooltip';
import { GuardAuthZ } from 'components/GuardAuthZ/GuardAuthZ';
import {
	createProject,
	deleteProject,
	listProjects,
	updateProject,
} from 'api/v1/projects/list';
import {
	buildProjectDeletePermission,
	buildProjectUpdatePermission,
} from 'hooks/useAuthZ/permissions/project.permissions';
import type {
	PostableProject,
	Project,
	ProjectLogType,
} from 'types/api/v1/projects';

import './ProjectSettings.styles.scss';

const PROJECT_LOG_TYPES: ProjectLogType[] = [
	'application',
	'system',
	'audit',
	'access',
];

type FormState = {
	name: string;
	description: string;
	logTypes: ProjectLogType[];
};

const emptyForm = (): FormState => ({
	name: '',
	description: '',
	logTypes: ['application'],
});

function ProjectSettings(): JSX.Element {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState('');
	const [showForm, setShowForm] = useState(false);
	const [editing, setEditing] = useState<Project | null>(null);
	const [form, setForm] = useState<FormState>(emptyForm());

	const projectsQuery = useQuery(['projects'], listProjects, {
		select: (res) => res?.data ?? [],
	});

	const createMutation = useMutation(
		(body: PostableProject) => createProject(body),
		{
			onSuccess: () => {
				queryClient.invalidateQueries(['projects']);
				setShowForm(false);
				setForm(emptyForm());
			},
		},
	);

	const updateMutation = useMutation(
		(args: {
			id: string;
			body: { description?: string; logTypes?: ProjectLogType[] };
		}) => updateProject(args.id, args.body),
		{
			onSuccess: () => {
				queryClient.invalidateQueries(['projects']);
				setEditing(null);
				setShowForm(false);
				setForm(emptyForm());
			},
		},
	);

	const deleteMutation = useMutation((id: string) => deleteProject(id), {
		onSuccess: () => queryClient.invalidateQueries(['projects']),
	});

	const filtered = (projectsQuery.data ?? []).filter((p) =>
		search ? p.name.toLowerCase().includes(search.toLowerCase()) : true,
	);

	const startEdit = (p: Project): void => {
		setEditing(p);
		setForm({
			name: p.name,
			description: p.description,
			logTypes: p.logTypes,
		});
		setShowForm(true);
	};

	const submit = (): void => {
		if (editing) {
			updateMutation.mutate({ id: editing.name, body: form });
		} else {
			createMutation.mutate(form);
		}
	};

	const toggleLogType = (lt: ProjectLogType): void => {
		setForm((prev) => ({
			...prev,
			logTypes: prev.logTypes.includes(lt)
				? prev.logTypes.filter((t) => t !== lt)
				: [...prev.logTypes, lt],
		}));
	};

	return (
		<div className="project-settings" data-testid="project-settings">
			<header className="project-settings-header">
				<h3 className="project-settings-header-title">Projects</h3>
				<p className="project-settings-header-description">
					Projects group log sources so you can grant per-project, per-log-type read
					access to roles.
				</p>
			</header>

			<div className="project-settings-content">
				<div className="project-settings-toolbar">
					<Input
						type="search"
						placeholder="Search for projects..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						data-testid="project-settings-search"
					/>
					<GuardAuthZ relation="create" object="project:*">
						<Button
							type="button"
							variant="solid"
							color="primary"
							prefix={<Plus size={14} />}
							onClick={(): void => {
								setEditing(null);
								setForm(emptyForm());
								setShowForm(true);
							}}
							data-testid="project-settings-new"
						>
							New project
						</Button>
					</GuardAuthZ>
				</div>

				<GuardAuthZ relation="list" object="project:*">
					<div className="project-settings-table-wrapper">
						{projectsQuery.isLoading ? (
							<div className="project-settings-empty">Loading...</div>
						) : filtered.length === 0 ? (
							<div className="project-settings-empty">
								No projects yet. Create one to start gating log access.
							</div>
						) : (
							<table className="project-settings-table">
								<thead>
									<tr>
										<th>Name</th>
										<th>Description</th>
										<th>Log types</th>
										<th>Created</th>
										<th aria-label="actions" />
									</tr>
								</thead>
								<tbody>
									{filtered.map((p) => (
										<tr key={p.id} data-testid={`project-row-${p.name}`}>
											<td>{p.name}</td>
											<td>{p.description || '—'}</td>
											<td>
												{p.logTypes.map((lt) => (
													<span key={lt} className="project-settings-logtype-chip">
														{lt}
													</span>
												))}
											</td>
											<td>{new Date(p.createdAt).toLocaleDateString()}</td>
											<td className="project-settings-actions">
												<AuthZTooltip checks={[buildProjectUpdatePermission(p.name)]}>
													<Button
														type="button"
														variant="link"
														color="secondary"
														size="sm"
														onClick={(): void => startEdit(p)}
													>
														Edit
													</Button>
												</AuthZTooltip>
												<AuthZTooltip checks={[buildProjectDeletePermission(p.name)]}>
													<Button
														type="button"
														variant="link"
														color="destructive"
														size="sm"
														prefix={<Trash2 size={14} />}
														onClick={(): void => deleteMutation.mutate(p.name)}
														data-testid={`project-delete-${p.name}`}
													>
														Delete
													</Button>
												</AuthZTooltip>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</GuardAuthZ>
			</div>

			{showForm && (
				<div
					className="project-settings-form-drawer"
					data-testid="project-settings-form"
				>
					<h4>{editing ? 'Edit project' : 'New project'}</h4>
					<label htmlFor="project-form-name-input">Name</label>
					<Input
						id="project-form-name-input"
						value={form.name}
						disabled={!!editing}
						onChange={(e): void => setForm((p) => ({ ...p, name: e.target.value }))}
						data-testid="project-form-name"
					/>
					<label htmlFor="project-form-description-input">Description</label>
					<Input
						id="project-form-description-input"
						value={form.description}
						onChange={(e): void =>
							setForm((p) => ({ ...p, description: e.target.value }))
						}
						data-testid="project-form-description"
					/>
					<div>
						<span>Log types</span>
						<div className="project-settings-logtype-options">
							{PROJECT_LOG_TYPES.map((lt) => (
								<label key={lt} className="project-settings-logtype-option">
									<input
										type="checkbox"
										checked={form.logTypes.includes(lt)}
										onChange={(): void => toggleLogType(lt)}
									/>
									{lt}
								</label>
							))}
						</div>
					</div>
					<div className="project-settings-form-actions">
						<Button
							type="button"
							variant="solid"
							color="secondary"
							onClick={(): void => {
								setShowForm(false);
								setEditing(null);
								setForm(emptyForm());
							}}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="solid"
							color="primary"
							loading={createMutation.isLoading || updateMutation.isLoading}
							onClick={submit}
							data-testid="project-form-submit"
						>
							{editing ? 'Save' : 'Create'}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export default ProjectSettings;
