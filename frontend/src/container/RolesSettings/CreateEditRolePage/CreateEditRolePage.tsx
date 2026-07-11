import { useCallback, useState } from 'react';
import { matchPath, useHistory, useLocation } from 'react-router-dom';
import { ArrowLeft, SolidAlertTriangle, Plus, Trash2 } from '@signozhq/icons';
import { Button } from '@signozhq/ui/button';
import { ConfirmDialog } from '@signozhq/ui/dialog';
import { Input } from '@signozhq/ui/input';
import { Switch } from '@signozhq/ui/switch';
import { Typography } from '@signozhq/ui/typography';
import { RadioGroup, RadioGroupItem } from '@signozhq/ui/radio-group';
import { Skeleton, Select, Input as AntdInput } from 'antd';
import ErrorInPlace from 'components/ErrorInPlace/ErrorInPlace';
import PermissionDeniedFullPage from 'lib/authz/components/PermissionDeniedFullPage/PermissionDeniedFullPage';
import ROUTES from 'constants/routes';
import { useRolesFeatureGate } from 'hooks/useRolesFeatureGate';
import useUrlQuery from 'hooks/useUrlQuery';
import APIError from 'types/api/error';

import PermissionEditor from './components/PermissionEditor';
import { useCreateEditRolePageActions } from './useCreateEditRolePageActions';
import { useNavigationBlocker } from 'hooks/useNavigationBlocker';
import type { ProjectPermissionRecord } from '../projectPermissionsHelper';
import { useServicesList } from 'hooks/useServicesList';

import styles from './CreateEditRolePage.module.scss';

function CreateEditRolePage(): JSX.Element {
	const history = useHistory();
	const { pathname } = useLocation();
	const urlQuery = useUrlQuery();
	const match = matchPath<{ roleId: string }>(pathname, {
		path: ROUTES.ROLE_DETAILS,
	});
	const roleId = match?.params?.roleId ?? 'new';
	const roleName = urlQuery.get('name') ?? '';
	const [hasJsonError, setHasJsonError] = useState(false);
	const { isRolesEnabled, isLoading: isFeatureGateLoading } =
		useRolesFeatureGate();

	const {
		formData,
		editorMode,
		setEditorMode,
		resources,
		setResources,
		projectPermissions,
		setProjectPermissions,
		isLoading,
		isSaving,
		hasUnsavedChanges,
		handleSave,
		handleCancel,
		handleFormChange,
		saveError,
		validationErrors,
		isCreateMode,
		hasRequiredPermission,
		isAuthZLoading,
		deniedPermission,
		loadError,
	} = useCreateEditRolePageActions(roleId, roleName);

	const { isBlocked, confirmNavigation, cancelNavigation, allowNextNavigation } =
		useNavigationBlocker(hasUnsavedChanges);

	const handleSaveAndNavigate = useCallback(async (): Promise<void> => {
		if (hasJsonError) {
			return;
		}

		const success = await handleSave();
		if (success) {
			allowNextNavigation();
			if (isCreateMode) {
				history.push(ROUTES.ROLES_SETTINGS);
			} else {
				const viewUrl = `${ROUTES.ROLE_DETAILS.replace(':roleId', roleId)}?name=${encodeURIComponent(roleName)}`;
				history.push(viewUrl);
			}
		}
	}, [
		handleSave,
		allowNextNavigation,
		history,
		hasJsonError,
		isCreateMode,
		roleId,
		roleName,
	]);

	const { data: fetchedServices } = useServicesList();
	const availableServices = ['All Services', ...(fetchedServices || [])];

	const addServicePermission = useCallback((): void => {
		setProjectPermissions((prev) => [
			...prev,
			{
				project: availableServices[0],
				apm: 'none',
				traces: 'none',
				logs: 'none',
				alerts: 'none',
				externalApi: 'none',
				logScope: { type: 'all' },
			},
		]);
	}, [setProjectPermissions, availableServices]);

	const updateServicePermission = useCallback(
		(index: number, updated: Partial<ProjectPermissionRecord>): void => {
			setProjectPermissions((prev) => {
				const next = [...prev];
				next[index] = { ...next[index], ...updated };
				return next;
			});
		},
		[setProjectPermissions],
	);

	const removeServicePermission = useCallback(
		(index: number): void => {
			setProjectPermissions((prev) => prev.filter((_, i) => i !== index));
		},
		[setProjectPermissions],
	);

	if (!hasRequiredPermission && !isAuthZLoading) {
		return <PermissionDeniedFullPage permissionName={deniedPermission} />;
	}

	if (!isRolesEnabled && !isFeatureGateLoading) {
		return (
			<div
				className={styles.createEditRolePage}
				data-testid="create-edit-role-page"
			>
				<div className={styles.createEditRolePageHeader}>
					<div className={styles.createEditRolePageHeaderLeft}>
						<Button
							variant="ghost"
							color="secondary"
							onClick={handleCancel}
							data-testid="cancel-button"
							className={styles.backButton}
						>
							<ArrowLeft size={16} />
						</Button>
						<Typography.Title level={3}>
							{isCreateMode ? 'Create Role' : 'Edit Role'}
						</Typography.Title>
					</div>
				</div>

				<ErrorInPlace
					error={
						new APIError({
							httpStatusCode: 403,
							error: {
								code: 'FEATURE_DISABLED',
								message:
									'Custom roles feature is not available. Please check your license or feature configuration.',
								url: '',
								errors: [],
							},
						})
					}
					data-testid="feature-gate-error-banner"
				/>
			</div>
		);
	}

	if (isAuthZLoading || (isLoading && !isCreateMode) || isFeatureGateLoading) {
		return (
			<div className={styles.createEditRolePage}>
				<Skeleton active paragraph={{ rows: 8 }} />
			</div>
		);
	}

	if (loadError) {
		return (
			<div
				className={styles.createEditRolePage}
				data-testid="create-edit-role-page"
			>
				<div className={styles.createEditRolePageHeader}>
					<div className={styles.createEditRolePageHeaderLeft}>
						<Button
							variant="ghost"
							color="secondary"
							onClick={handleCancel}
							disabled={isSaving}
							data-testid="cancel-button"
							className={styles.backButton}
						>
							<ArrowLeft size={16} />
						</Button>
						<Typography.Title level={3}>Failed to load role</Typography.Title>
					</div>
				</div>

				<ErrorInPlace error={loadError} data-testid="role-load-error-banner" />
			</div>
		);
	}

	return (
		<div
			className={styles.createEditRolePage}
			data-testid="create-edit-role-page"
		>
			<div className={styles.createEditRolePageHeader}>
				<div className={styles.createEditRolePageHeaderLeft}>
					<Button
						variant="ghost"
						color="secondary"
						onClick={handleCancel}
						disabled={isSaving}
						data-testid="cancel-button"
						className={styles.backButton}
					>
						<ArrowLeft size={16} />
					</Button>
					<Typography.Title level={3}>
						{isCreateMode
							? 'Create Role'
							: `Role - ${formData.name || 'Loading role...'}`}
					</Typography.Title>
				</div>

				<div className={styles.createEditRolePageActions}>
					{hasUnsavedChanges && (
						<div className={styles.unsavedIndicator}>
							<span className={styles.unsavedDot} />
							<Typography as="span" size="base" className={styles.unsavedText}>
								Unsaved changes
							</Typography>
						</div>
					)}
					<Button
						variant="solid"
						color="primary"
						onClick={handleSaveAndNavigate}
						loading={isSaving}
						disabled={!hasUnsavedChanges || hasJsonError}
						data-testid="save-button"
					>
						{isCreateMode ? 'Create role' : 'Save changes'}
					</Button>
				</div>
			</div>

			{saveError && (
				<ErrorInPlace
					error={saveError}
					height="auto"
					data-testid="save-error-banner"
					padding={0}
					bordered={true}
					className={styles.errorInPlaceContainer}
				/>
			)}

			<div className={styles.createEditRolePageContent}>
				<div className={styles.createEditRolePageForm}>
					<div className={styles.formRow}>
						{isCreateMode ? (
							<div className={styles.formField}>
								<label htmlFor="role-name" className={styles.formLabel}>
									Name
								</label>
								<Input
									id="role-name"
									value={formData.name}
									onChange={(e): void => handleFormChange('name', e.target.value)}
									placeholder="my-custom-role"
									data-testid="role-name-input"
								/>
							</div>
						) : null}
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

				<div className={styles.projectSection}>
					<div className={styles.projectSectionHeader}>
						<div>
							<Typography.Title level={4} style={{ margin: 0 }}>
								Service-Scoped Access Controls
							</Typography.Title>
							<Typography
								style={{ color: '#8c9ba5', fontSize: '13px', marginTop: '4px' }}
							>
								Configure service-specific APM, Traces, Logs, and Alerts permissions for
								this role.
							</Typography>
						</div>
						<Button
							variant="outlined"
							color="secondary"
							onClick={addServicePermission}
							data-testid="add-project-permission-button"
						>
							<Plus size={14} style={{ marginRight: '6px' }} />
							Add Service Scope
						</Button>
					</div>

					{projectPermissions.length === 0 ? (
						<div
							style={{
								color: '#8c9ba5',
								fontSize: '13px',
								textAlign: 'center',
								padding: '24px 0',
							}}
						>
							No service-scoped permissions defined. This role will have standard
							workspace-wide access.
						</div>
					) : (
						<div className={styles.projectRowList}>
							{projectPermissions.length > 0 && (
								<div className={styles.projectGridHeader}>
									<div>Service Name</div>
									<div>Access Controls</div>
									<div />
								</div>
							)}
							{projectPermissions.map((item, index) => (
								<div key={index} className={styles.projectRow}>
									<div className={styles.projectRowGrid}>
										<div className={styles.projectCell}>
											<span className={styles.projectCellLabel}>Service Name</span>
											<Select
												value={item.project}
												onChange={(val): void =>
													updateServicePermission(index, { project: val })
												}
												style={{ width: '100%', minWidth: '100px' }}
											>
												{availableServices.map((proj) => (
													<Select.Option key={proj} value={proj}>
														{proj}
													</Select.Option>
												))}
											</Select>
										</div>

										<div className={styles.permissionsCol}>
											<div
												className={styles.permissionsRow}
												style={{ marginBottom: '10px', marginLeft: '20px' }}
											>
												<div className={styles.permissionField}>
													<span className={styles.permissionLabel}>APM</span>
													<Select
														value={item.apm}
														onChange={(val): void =>
															updateServicePermission(index, { apm: val })
														}
														style={{ width: '160px' }}
													>
														<Select.Option value="none">None</Select.Option>
														<Select.Option value="read">Read</Select.Option>
														<Select.Option value="write">Read & Write</Select.Option>
													</Select>
												</div>

												<div className={styles.permissionField}>
													<span className={styles.permissionLabel}>Traces</span>
													<Select
														value={item.traces}
														onChange={(val): void =>
															updateServicePermission(index, { traces: val })
														}
														style={{ width: '160px' }}
													>
														<Select.Option value="none">None</Select.Option>
														<Select.Option value="read">Read</Select.Option>
														<Select.Option value="write">Read & Write</Select.Option>
													</Select>
												</div>
											</div>

											<div
												className={styles.permissionsRow}
												style={{ marginLeft: '20px' }}
											>
												<div className={styles.permissionField}>
													<span className={styles.permissionLabel}>Alerts</span>
													<Select
														value={item.alerts || 'none'}
														onChange={(val): void =>
															updateServicePermission(index, { alerts: val })
														}
														style={{ width: '160px' }}
													>
														<Select.Option value="none">None</Select.Option>
														<Select.Option value="read">Read</Select.Option>
														<Select.Option value="write">Read & Write</Select.Option>
													</Select>
												</div>

												<div className={styles.permissionField}>
													<span>External APIs</span>
													<Switch
														value={item.externalApi === 'read'}
														onChange={(checked): void =>
															updateServicePermission(index, {
																externalApi: checked ? 'read' : 'none',
															})
														}
													/>
												</div>

												<div className={styles.permissionField}>
													<span>Logs</span>
													<Switch
														value={item.logs === 'read'}
														onChange={(checked): void => {
															updateServicePermission(index, {
																logs: checked ? 'read' : 'none',
																logScope: checked
																	? item.logScope || { type: 'all' }
																	: undefined,
															});
														}}
													/>
												</div>
											</div>
										</div>

										<div className={styles.deleteCell}>
											<Button
												variant="outlined"
												color="destructive"
												onClick={(): void => removeServicePermission(index)}
												className={styles.deleteButton}
												title="Remove Service Scope"
											>
												<Trash2 size={14} />
											</Button>
										</div>
									</div>

									{item.logs === 'read' && (
										<div className={styles.logScopeSection}>
											<span className={styles.logScopeLabel}>Log Scope:</span>
											<RadioGroup
												value={item.logScope?.type || 'all'}
												onChange={(value): void => {
													const scopeType = value as 'all' | 'specific';
													updateServicePermission(index, {
														logScope: {
															type: scopeType,
															value:
																scopeType === 'specific'
																	? item.logScope?.value || ''
																	: undefined,
														},
													});
												}}
											>
												<RadioGroupItem value="all">All Log Types</RadioGroupItem>
												<RadioGroupItem value="specific">Specific Log Type</RadioGroupItem>
											</RadioGroup>

											{item.logScope?.type === 'specific' && (
												<div className={styles.logScopeInputWrapper}>
													<AntdInput
														placeholder="e.g. nginx-access, application-json"
														value={item.logScope.value || ''}
														onChange={(e): void =>
															updateServicePermission(index, {
																logScope: { type: 'specific', value: e.target.value },
															})
														}
														style={{ width: '250px' }}
													/>
												</div>
											)}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				<div className={styles.createEditRolePageDivider} />

				<PermissionEditor
					resources={resources}
					mode={editorMode}
					onModeChange={setEditorMode}
					onResourceChange={setResources}
					onJsonValidityChange={setHasJsonError}
					isLoading={isLoading}
					validationErrors={validationErrors}
				/>
			</div>

			<ConfirmDialog
				open={isBlocked}
				onOpenChange={(next): void => {
					if (!next) {
						cancelNavigation();
					}
				}}
				title="Discard unsaved changes?"
				titleIcon={<SolidAlertTriangle size={14} color="#fdd600" />}
				confirmText="Discard"
				confirmColor="destructive"
				cancelText="Keep editing"
				onConfirm={confirmNavigation}
				onCancel={cancelNavigation}
				data-testid="discard-changes-dialog"
			>
				<Typography>
					{isCreateMode
						? 'This new role will not be created.'
						: 'Your unsaved changes will be lost.'}
				</Typography>
			</ConfirmDialog>
		</div>
	);
}

export default CreateEditRolePage;
