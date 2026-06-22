import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from '@signozhq/ui/sonner';
import ROUTES from 'constants/routes';

import type { ResourcePermissions } from '../types';
import type { EditorMode } from './components/JsonEditor.types';
import {
	createEmptyRolePermissions,
	useCreateRolePermissions,
	useRolePermissions,
	useUpdateRolePermissions,
} from '../useRolePermissions';
import { useRoleAuthZ } from './useRoleAuthZ';
import {
	useRoleUnsavedChanges,
	type RoleFormData,
} from './useRoleUnsavedChanges';
import { useRoleFormValidation } from './useRoleFormValidation';

interface UseCreateEditRolePageCallbacksResult {
	formData: RoleFormData;
	setFormData: React.Dispatch<React.SetStateAction<RoleFormData>>;
	editorMode: EditorMode;
	setEditorMode: (mode: EditorMode) => void;
	resources: ResourcePermissions[];
	setResources: (resources: ResourcePermissions[]) => void;
	isLoading: boolean;
	isSaving: boolean;
	hasUnsavedChanges: boolean;
	handleSave: () => void;
	handleCancel: () => void;
	handleFormChange: (field: keyof RoleFormData, value: string) => void;
	isCreateMode: boolean;
	saveError: string | null;
	clearSaveError: () => void;
	validationErrors: Set<string>;
	hasRequiredPermission: boolean;
	isAuthZLoading: boolean;
	deniedPermission: string;
}

export function useCreateEditRolePageCallbacks(
	roleId: string,
	roleName: string,
): UseCreateEditRolePageCallbacksResult {
	const history = useHistory();
	const isCreateMode = roleId === 'new';

	const { hasRequiredPermission, isAuthZLoading, deniedPermission } =
		useRoleAuthZ(isCreateMode, roleName);

	const [formData, setFormData] = useState<RoleFormData>({
		name: '',
		description: '',
	});
	const [editorMode, setEditorMode] = useState<EditorMode>('interactive');
	const emptyResources = useMemo(() => createEmptyRolePermissions(), []);
	const [localResources, setLocalResources] = useState<ResourcePermissions[]>(
		() => (isCreateMode ? createEmptyRolePermissions() : []),
	);
	const [isInitialized, setIsInitialized] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const { validationErrors, validateResources, clearValidationErrors } =
		useRoleFormValidation();

	const { data: rolePermissionsData, isLoading: isLoadingPermissions } =
		useRolePermissions(roleId, {
			enabled: !isCreateMode && hasRequiredPermission,
		});

	const { mutateAsync: createRole, isLoading: isCreating } =
		useCreateRolePermissions();
	const { mutateAsync: updateRole, isLoading: isUpdating } =
		useUpdateRolePermissions();
	const isSaving = isCreating || isUpdating;

	useEffect(() => {
		if (rolePermissionsData && !isInitialized) {
			setFormData({
				name: rolePermissionsData.roleName,
				description: rolePermissionsData.roleDescription,
			});
			setLocalResources(JSON.parse(JSON.stringify(rolePermissionsData.resources)));
			setIsInitialized(true);
		}
	}, [rolePermissionsData, isInitialized]);

	const handleFormChange = useCallback(
		(field: keyof RoleFormData, value: string): void => {
			setFormData((prev) => ({
				...prev,
				[field]: value,
			}));
		},
		[],
	);

	const handleModeChange = useCallback((mode: EditorMode): void => {
		setEditorMode(mode);
	}, []);

	const handleResourcesChange = useCallback(
		(resources: ResourcePermissions[]): void => {
			setLocalResources(resources);
		},
		[],
	);

	const hasUnsavedChanges = useRoleUnsavedChanges(
		isCreateMode,
		formData,
		localResources,
		rolePermissionsData,
		emptyResources,
	);

	const handleSave = useCallback(async (): Promise<void> => {
		if (!formData.name.trim()) {
			toast.error('Role name is required', { position: 'bottom-center' });
			return;
		}

		const validationError = validateResources(localResources);
		if (validationError) {
			setSaveError(validationError);
			return;
		}

		clearValidationErrors();
		setSaveError(null);

		try {
			if (isCreateMode) {
				await createRole({
					name: formData.name,
					description: formData.description,
					resources: localResources,
				});
			} else {
				await updateRole({
					roleId,
					description: formData.description,
					resources: localResources,
				});
			}
			toast.success(
				isCreateMode ? 'Role created successfully' : 'Role updated successfully',
				{ position: 'bottom-center' },
			);
			history.push(ROUTES.ROLES_SETTINGS);
		} catch (error) {
			const axiosError = error as {
				response?: { data?: { error?: { message?: string }; message?: string } };
				message?: string;
			};
			const errorMessage =
				axiosError?.response?.data?.error?.message ||
				axiosError?.response?.data?.message ||
				axiosError?.message ||
				'Failed to save role';
			setSaveError(errorMessage);
		}
	}, [
		formData.name,
		formData.description,
		isCreateMode,
		roleId,
		localResources,
		createRole,
		updateRole,
		history,
		validateResources,
		clearValidationErrors,
	]);

	const clearSaveError = useCallback((): void => {
		setSaveError(null);
	}, []);

	const handleCancel = useCallback((): void => {
		history.push(ROUTES.ROLES_SETTINGS);
	}, [history]);

	return {
		formData,
		setFormData,
		editorMode,
		setEditorMode: handleModeChange,
		resources: localResources,
		setResources: handleResourcesChange,
		isLoading: isLoadingPermissions,
		isSaving,
		hasUnsavedChanges,
		handleSave,
		handleCancel,
		handleFormChange,
		isCreateMode,
		saveError,
		clearSaveError,
		validationErrors,
		hasRequiredPermission,
		isAuthZLoading,
		deniedPermission,
	};
}
