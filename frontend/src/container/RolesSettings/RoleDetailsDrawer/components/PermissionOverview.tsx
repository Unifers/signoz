import { Skeleton } from 'antd';

import { useRolePermissions } from '../../useRolePermissions';

import ResourcePermissionCard from './ResourcePermissionCard';

import styles from './PermissionOverview.module.scss';

export interface PermissionOverviewProps {
	roleId: string;
}

function PermissionOverview({ roleId }: PermissionOverviewProps): JSX.Element {
	const { data: permissions, isLoading, isError } = useRolePermissions(roleId);

	if (isLoading) {
		return (
			<div className={styles.container} data-testid="permission-overview-loading">
				<Skeleton active paragraph={{ rows: 8 }} />
			</div>
		);
	}

	if (isError || !permissions) {
		return (
			<div className={styles.container} data-testid="permission-overview-error">
				<p className={styles.errorText}>Failed to load permissions</p>
			</div>
		);
	}

	const { resources } = permissions;

	return (
		<div className={styles.container} data-testid="permission-overview">
			<div className={styles.grid}>
				{resources.map((resource) => (
					<ResourcePermissionCard key={resource.resourceId} resource={resource} />
				))}
			</div>
		</div>
	);
}

export default PermissionOverview;
