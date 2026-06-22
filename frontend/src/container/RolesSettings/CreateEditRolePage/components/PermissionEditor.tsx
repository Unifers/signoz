import { useCallback } from 'react';
import { RadioGroup, RadioGroupItem } from '@signozhq/ui/radio-group';
import { Skeleton } from 'antd';
import type { AuthZResource, AuthZVerb } from 'hooks/useAuthZ/types';

import { PermissionScope, ResourcePermissions } from '../../types';
import type { EditorMode } from './JsonEditor.types';
import JsonEditor from './JsonEditor';
import ResourceCard from './ResourceCard';

import styles from './PermissionEditor.module.scss';

interface PermissionEditorProps {
	resources: ResourcePermissions[];
	mode: EditorMode;
	onModeChange: (mode: EditorMode) => void;
	onResourceChange: (resources: ResourcePermissions[]) => void;
	isLoading?: boolean;
	validationErrors?: Set<string>;
}

function PermissionEditor({
	resources,
	mode,
	onModeChange,
	onResourceChange,
	isLoading = false,
	validationErrors,
}: PermissionEditorProps): JSX.Element {
	const handleActionChange = useCallback(
		(
			resourceId: AuthZResource,
			action: AuthZVerb,
			scope: PermissionScope,
			selectedIds: string[],
		): void => {
			const updatedResources = resources.map((r) => {
				if (r.resourceId !== resourceId) {
					return r;
				}
				return {
					...r,
					actions: {
						...r.actions,
						[action]: {
							scope: scope,
							selectedIds,
						},
					},
				};
			});
			onResourceChange(updatedResources);
		},
		[resources, onResourceChange],
	);

	const handleJsonChange = useCallback(
		(updatedResources: ResourcePermissions[]): void => {
			onResourceChange(updatedResources);
		},
		[onResourceChange],
	);

	const handleModeChange = useCallback(
		(value: string): void => {
			onModeChange(value as EditorMode);
		},
		[onModeChange],
	);

	if (isLoading) {
		return (
			<div className={styles.permissionEditor}>
				<Skeleton active paragraph={{ rows: 6 }} />
			</div>
		);
	}

	return (
		<div className={styles.permissionEditor} data-testid="permission-editor">
			<div className={styles.permissionEditorHeader}>
				<span className={styles.permissionEditorTitle}>Permissions</span>
				<RadioGroup
					className={styles.permissionEditorModeToggle}
					value={mode}
					onChange={handleModeChange}
					testId="permission-editor-mode"
				>
					<RadioGroupItem
						value="interactive"
						containerClassName={styles.permissionEditorModeItem}
						className={styles.permissionEditorModeInput}
						testId="permission-editor-mode-interactive"
					>
						Interactive
					</RadioGroupItem>
					<RadioGroupItem
						value="json"
						containerClassName={styles.permissionEditorModeItem}
						className={styles.permissionEditorModeInput}
						testId="permission-editor-mode-json"
					>
						JSON
					</RadioGroupItem>
				</RadioGroup>
			</div>

			<div className={styles.permissionEditorContent}>
				{mode === 'interactive' ? (
					<div className={styles.permissionEditorResourceList}>
						{resources.map((resource) => (
							<ResourceCard
								key={resource.resourceId}
								resource={resource}
								onActionChange={handleActionChange}
								defaultExpanded={true}
								validationErrors={validationErrors}
							/>
						))}
					</div>
				) : (
					<JsonEditor
						resources={resources}
						mode={mode}
						onChange={handleJsonChange}
					/>
				)}
			</div>
		</div>
	);
}

export default PermissionEditor;
