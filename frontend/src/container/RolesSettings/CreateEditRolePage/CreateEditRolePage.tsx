import { Link, matchPath, useLocation } from 'react-router-dom';
import { X } from '@signozhq/icons';
import { Button } from '@signozhq/ui/button';
import { Input } from '@signozhq/ui/input';
import { BreadcrumbSimple } from '@signozhq/ui/breadcrumb';
import { Skeleton } from 'antd';
import PermissionDeniedFullPage from 'components/PermissionDeniedFullPage/PermissionDeniedFullPage';
import ROUTES from 'constants/routes';
import useUrlQuery from 'hooks/useUrlQuery';

import PermissionEditor from './components/PermissionEditor';
import { useCreateEditRolePageCallbacks } from './useCreateEditRolePageCallbacks';

import styles from './CreateEditRolePage.module.scss';

function CreateEditRolePage(): JSX.Element {
	const { pathname } = useLocation();
	const urlQuery = useUrlQuery();
	const match = matchPath<{ roleId: string }>(pathname, {
		path: ROUTES.ROLE_DETAILS,
	});
	const roleId = match?.params?.roleId ?? 'new';
	const roleName = urlQuery.get('name') ?? '';

	const {
		formData,
		editorMode,
		setEditorMode,
		resources,
		setResources,
		isLoading,
		isSaving,
		hasUnsavedChanges,
		handleSave,
		handleCancel,
		handleFormChange,
		saveError,
		clearSaveError,
		validationErrors,
		isCreateMode,
		hasRequiredPermission,
		isAuthZLoading,
		deniedPermission,
	} = useCreateEditRolePageCallbacks(roleId, roleName);

	if (!hasRequiredPermission && !isAuthZLoading) {
		return <PermissionDeniedFullPage permissionName={deniedPermission} />;
	}

	if (isAuthZLoading || (isLoading && !isCreateMode)) {
		return (
			<div className={styles.createEditRolePage}>
				<Skeleton active paragraph={{ rows: 8 }} />
			</div>
		);
	}

	return (
		<div
			className={styles.createEditRolePage}
			data-testid="create-edit-role-page"
		>
			<div className={styles.createEditRolePageHeader}>
				<BreadcrumbSimple
					items={[
						{
							title: 'Roles',
							path: ROUTES.ROLES_SETTINGS,
						},
						{
							title: isCreateMode ? 'Create role' : 'Edit role',
						},
					]}
					itemRender={(route, _, routes) => {
						const isLast = route === routes[routes.length - 1];
						return isLast ? (
							<span>{route.title}</span>
						) : (
							<Link to={route.path!}>{route.title}</Link>
						);
					}}
				/>
				<div className={styles.createEditRolePageActions}>
					{hasUnsavedChanges && (
						<div className={styles.unsavedIndicator}>
							<span className={styles.unsavedDot} />
							<span className={styles.unsavedText}>Unsaved changes</span>
						</div>
					)}
					<Button
						variant="solid"
						color="secondary"
						onClick={handleCancel}
						disabled={isSaving}
						data-testid="cancel-button"
					>
						Cancel
					</Button>
					<Button
						variant="solid"
						color="primary"
						onClick={handleSave}
						loading={isSaving}
						disabled={!hasUnsavedChanges}
						data-testid="save-button"
					>
						{isCreateMode ? 'Create role' : 'Save changes'}
					</Button>
				</div>
			</div>

			{saveError && (
				<div className={styles.errorBanner} data-testid="save-error-banner">
					<span className={styles.errorBannerMessage}>{saveError}</span>
					<button
						type="button"
						className={styles.errorBannerDismiss}
						onClick={clearSaveError}
						aria-label="Dismiss error"
					>
						<X size={14} />
					</button>
				</div>
			)}

			<div className={styles.createEditRolePageContent}>
				<div className={styles.createEditRolePageForm}>
					<div className={styles.formRow}>
						<div className={styles.formField}>
							<label htmlFor="role-name" className={styles.formLabel}>
								Name
							</label>
							<Input
								id="role-name"
								value={formData.name}
								onChange={(e): void => handleFormChange('name', e.target.value)}
								placeholder="my-custom-role"
								disabled={!isCreateMode}
								data-testid="role-name-input"
							/>
						</div>
						<div className={styles.formField}>
							<label htmlFor="role-description" className={styles.formLabel}>
								Description
							</label>
							<Input
								id="role-description"
								value={formData.description}
								onChange={(e): void => handleFormChange('description', e.target.value)}
								placeholder="Custom role for the support team"
								data-testid="role-description-input"
							/>
						</div>
					</div>
				</div>

				<div className={styles.createEditRolePageDivider} />

				<PermissionEditor
					resources={resources}
					mode={editorMode}
					onModeChange={setEditorMode}
					onResourceChange={setResources}
					isLoading={isLoading}
					validationErrors={validationErrors}
				/>
			</div>
		</div>
	);
}

export default CreateEditRolePage;
