import { getResourcePanel } from '../../permissions.config';
import { PermissionScope, ResourcePermissions } from '../../types';

import ActionRow from './ActionRow';
import { getActionLabel } from './permissionDisplay.utils';

import styles from './ResourcePermissionCard.module.scss';

export interface ResourcePermissionCardProps {
	resource: ResourcePermissions;
}

function ResourcePermissionCard({
	resource,
}: ResourcePermissionCardProps): JSX.Element {
	const { resourceLabel, resourceKind, actions, availableActions } = resource;

	const panel = getResourcePanel(resourceKind);
	const Icon = panel.icon;

	const grantedCount = availableActions.filter((actionName) => {
		const config = actions[actionName];
		return !!config && config.scope !== PermissionScope.NONE;
	}).length;
	const totalCount = availableActions.length;

	return (
		<section
			className={styles.card}
			data-testid={`resource-section-${resourceKind}`}
		>
			<header className={styles.header}>
				<div className={styles.headerLeft}>
					<span className={styles.icon}>
						<Icon size={16} />
					</span>
					<h4 className={styles.title}>{resourceLabel}</h4>
				</div>
				<span
					className={styles.grantedCount}
					data-testid={`granted-count-${resourceKind}`}
				>
					{grantedCount} / {totalCount} granted
				</span>
			</header>

			<div className={styles.rows}>
				{availableActions.map((actionName) => {
					const config = actions[actionName];
					if (!config) {
						return null;
					}

					const selectedIds =
						config.scope === PermissionScope.ONLY_SELECTED ? config.selectedIds : [];

					return (
						<ActionRow
							key={actionName}
							actionName={actionName}
							actionLabel={getActionLabel(actionName)}
							scope={config.scope}
							selectedIds={selectedIds}
						/>
					);
				})}
			</div>
		</section>
	);
}

export default ResourcePermissionCard;
