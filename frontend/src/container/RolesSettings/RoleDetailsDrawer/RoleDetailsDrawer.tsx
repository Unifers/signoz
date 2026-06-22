import { useCallback, useMemo } from 'react';
import { Trash2, X } from '@signozhq/icons';
import { Badge } from '@signozhq/ui/badge';
import { Button } from '@signozhq/ui/button';
import { Callout } from '@signozhq/ui/callout';
import { DrawerWrapper } from '@signozhq/ui/drawer';
import { Skeleton, Tooltip } from 'antd';
import ErrorInPlace from 'components/ErrorInPlace/ErrorInPlace';
import { DATE_TIME_FORMATS } from 'constants/dateTimeFormats';
import { useTimezone } from 'providers/Timezone';
import { toAPIError } from 'utils/errorUtils';

import DeleteRoleModal from '../RolesComponents/DeleteRoleModal';

import PermissionOverview from './components/PermissionOverview';
import type { RoleDetailsDrawerProps } from './RoleDetailsDrawer.types';
import { useDeleteRoleModal } from './useDeleteRoleModal';
import { useRoleDetailsDrawerCallbacks } from './useRoleDetailsDrawerCallbacks';

import styles from './RoleDetailsDrawer.module.scss';

function RoleDetailsDrawer({
	roleId,
	roleName,
	onClose,
}: RoleDetailsDrawerProps): JSX.Element {
	const { formatTimezoneAdjustedTimestamp } = useTimezone();

	const {
		role,
		isLoading,
		isAuthZLoading,
		isError,
		error,
		isManaged,
		hasReadPermission,
		hasDeletePermission,
		isEditDisabled,
		editDisabledReason,
		handleViewDetails,
		permissions,
	} = useRoleDetailsDrawerCallbacks({ roleId, roleName });

	const {
		isDeleteModalOpen,
		isDeleteDisabled,
		deleteDisabledReason,
		deleteErrorMessage,
		handleOpenDeleteModal,
		handleCloseDeleteModal,
		handleConfirmDelete,
	} = useDeleteRoleModal({
		roleId,
		isManaged,
		hasDeletePermission,
		onDeleteSuccess: onClose,
	});

	const handleEditRole = useCallback((): void => {
		onClose();
		handleViewDetails();
	}, [onClose, handleViewDetails]);

	const formatTimestamp = useCallback(
		(date?: Date | string): string => {
			if (!date) {
				return '—';
			}
			const d = new Date(date);
			if (Number.isNaN(d.getTime())) {
				return '—';
			}
			return formatTimezoneAdjustedTimestamp(
				date,
				DATE_TIME_FORMATS.DASH_DATETIME,
			);
		},
		[formatTimezoneAdjustedTimestamp],
	);

	const typeBadgeColor = useMemo(() => {
		if (isManaged) {
			return 'robin';
		}
		return 'vanilla';
	}, [isManaged]);

	const deleteButton = (
		<Button
			variant="link"
			color="destructive"
			onClick={handleOpenDeleteModal}
			disabled={isDeleteDisabled}
			data-testid="role-drawer-delete-btn"
			prefix={<Trash2 />}
		>
			Delete role
		</Button>
	);

	const editButton = (
		<Button
			variant="solid"
			color="primary"
			onClick={handleEditRole}
			disabled={isEditDisabled}
			data-testid="role-drawer-edit-btn"
		>
			Edit role
		</Button>
	);

	return (
		<>
			<DrawerWrapper
				open={!!roleId}
				onOpenChange={(isOpen): void => {
					if (!isOpen) {
						onClose();
					}
				}}
				direction="right"
				showCloseButton
				showOverlay={false}
				title={role?.name ?? 'Role Details'}
				footer={
					<div className={styles.footer}>
						<div className={styles.footerLeft}>
							{isDeleteDisabled ? (
								<Tooltip title={deleteDisabledReason}>{deleteButton}</Tooltip>
							) : (
								deleteButton
							)}
						</div>
						<div className={styles.footerRight}>
							<Button
								variant="outlined"
								color="secondary"
								onClick={onClose}
								data-testid="role-drawer-close-btn"
							>
								<X size={14} />
								Close
							</Button>
							{isEditDisabled ? (
								<Tooltip title={editDisabledReason}>{editButton}</Tooltip>
							) : (
								editButton
							)}
						</div>
					</div>
				}
				width="wide"
				drawerDescriptionProps={{
					className: styles.drawerDescription,
				}}
			>
				{isAuthZLoading || isLoading ? (
					<Skeleton active paragraph={{ rows: 6 }} />
				) : !hasReadPermission && permissions !== null ? (
					<Callout type="error" showIcon title="Permission Denied">
						You do not have permission to view this role.
					</Callout>
				) : isError && error ? (
					<ErrorInPlace
						error={toAPIError(
							error,
							'An unexpected error occurred while fetching role details.',
						)}
					/>
				) : (
					<div className={styles.content}>
						<div className={styles.field}>
							<span className={styles.label}>Type</span>
							<Badge color={typeBadgeColor} variant="outline">
								{isManaged ? 'Managed' : 'Custom'}
							</Badge>
						</div>

						<div className={styles.field}>
							<span className={styles.label}>Description</span>
							<p className={styles.description}>{role?.description || '—'}</p>
						</div>

						<div className={styles.metaRow}>
							<div className={styles.metaItem}>
								<span className={styles.label}>Created At</span>
								<Badge color="vanilla">{formatTimestamp(role?.createdAt)}</Badge>
							</div>
							<div className={styles.metaItem}>
								<span className={styles.label}>Updated At</span>
								<Badge color="vanilla">{formatTimestamp(role?.updatedAt)}</Badge>
							</div>
						</div>

						{isManaged && (
							<Callout
								type="warning"
								showIcon
								title="This is a managed role. Permissions are view-only and cannot be modified."
							/>
						)}

						<div className={styles.permissionsSection}>
							<div className={styles.permissionsHeader}>
								<span className={styles.label}>Permissions</span>
							</div>
							{roleId && <PermissionOverview roleId={roleId} />}
						</div>
					</div>
				)}
			</DrawerWrapper>
			<DeleteRoleModal
				isOpen={isDeleteModalOpen}
				roleName={role?.name ?? ''}
				errorMessage={deleteErrorMessage}
				onCancel={handleCloseDeleteModal}
				onConfirm={handleConfirmDelete}
			/>
		</>
	);
}

export default RoleDetailsDrawer;
