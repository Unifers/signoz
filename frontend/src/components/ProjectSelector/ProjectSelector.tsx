import { useMemo } from 'react';
import { Select } from 'antd';
import { useAccessibleProjects } from 'hooks/project/useAccessibleProjects';
import { useCurrentProject } from 'hooks/project/useCurrentProject';
import type { ProjectLogType } from 'types/api/v1/projects';

import './ProjectSelector.styles.scss';

export type ProjectSelection = {
	projectSlug: string | null;
	logType: ProjectLogType | null;
};

type Props = {
	// Optional. When omitted, the selector reads/writes via ProjectProvider.
	value?: ProjectSelection;
	onChange?: (next: ProjectSelection) => void;
};

const { Option } = Select;

function ProjectSelector({
	value: valueProp,
	onChange: onChangeProp,
}: Props): JSX.Element {
	// When called without props, the selector binds to the global
	// ProjectProvider state so the rest of the app sees the same selection.
	const ctx = useCurrentProject();
	const value = valueProp ?? ctx.selection;
	const onChange = onChangeProp ?? ctx.setSelection;

	const accessible = useAccessibleProjects();
	const allowedTuples = useMemo(
		() => accessible.data.map((t) => ({ slug: t.slug, logType: t.logType })),
		[accessible.data],
	);

	const optionKey =
		value.projectSlug && value.logType
			? `${value.projectSlug}:${value.logType}`
			: '';

	return (
		<div className="project-selector" data-testid="project-selector">
			<Select
				value={optionKey || undefined}
				placeholder="Select project + log type"
				style={{ minWidth: 240 }}
				onChange={(key: string): void => {
					const idx = key.indexOf(':');
					if (idx === -1) {
						onChange({ projectSlug: null, logType: null });
						return;
					}
					const slug = key.slice(0, idx);
					const logType = key.slice(idx + 1) as ProjectLogType;
					onChange({ projectSlug: slug, logType });
				}}
				loading={accessible.isLoading}
				notFoundContent={
					allowedTuples.length === 0
						? 'No projects you have access to'
						: 'No projects yet'
				}
			>
				{allowedTuples.map((t) => (
					<Option key={`${t.slug}:${t.logType}`} value={`${t.slug}:${t.logType}`}>
						{t.slug} <span className="project-selector-logtype">/ {t.logType}</span>
					</Option>
				))}
			</Select>
		</div>
	);
}

export default ProjectSelector;
