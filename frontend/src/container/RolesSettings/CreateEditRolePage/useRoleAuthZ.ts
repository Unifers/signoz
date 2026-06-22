import { useMemo } from 'react';
import {
	RoleCreatePermission,
	buildRoleReadPermission,
	buildRoleUpdatePermission,
} from 'hooks/useAuthZ/permissions/role.permissions';
import { useAuthZ } from 'hooks/useAuthZ/useAuthZ';

interface UseRoleAuthZResult {
	hasRequiredPermission: boolean;
	isAuthZLoading: boolean;
	deniedPermission: string;
}

export function useRoleAuthZ(
	isCreateMode: boolean,
	roleName: string,
): UseRoleAuthZResult {
	const permissionsToCheck = useMemo(() => {
		if (isCreateMode) {
			return [RoleCreatePermission];
		}
		if (!roleName) {
			return [];
		}
		return [
			buildRoleReadPermission(roleName),
			buildRoleUpdatePermission(roleName),
		];
	}, [isCreateMode, roleName]);

	const { permissions, isLoading: isAuthZLoading } =
		useAuthZ(permissionsToCheck);

	const hasRequiredPermission = useMemo(() => {
		if (permissions === null) {
			return false;
		}
		if (isCreateMode) {
			return permissions[RoleCreatePermission]?.isGranted ?? false;
		}
		if (!roleName) {
			return true;
		}
		const readPerm = buildRoleReadPermission(roleName);
		const updatePerm = buildRoleUpdatePermission(roleName);
		return (
			(permissions[readPerm]?.isGranted ?? false) &&
			(permissions[updatePerm]?.isGranted ?? false)
		);
	}, [permissions, isCreateMode, roleName]);

	const deniedPermission = useMemo(() => {
		if (isCreateMode) {
			return 'role:create';
		}
		if (roleName) {
			return `role:${roleName}:update`;
		}
		return `role:<missing-rule-name>:update`;
	}, [isCreateMode, roleName]);

	return {
		hasRequiredPermission,
		isAuthZLoading,
		deniedPermission,
	};
}
