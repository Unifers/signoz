import { useCallback, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useGetRole } from 'api/generated/services/role';
import type {
	AuthtypesRoleWithTransactionGroupsDTO,
	RenderErrorResponseDTO,
} from 'api/generated/services/sigNoz.schemas';
import type { ErrorType } from 'api/generatedAPIInstance';
import ROUTES from 'constants/routes';
import {
	buildRoleDeletePermission,
	buildRoleReadPermission,
	buildRoleUpdatePermission,
} from 'hooks/useAuthZ/permissions/role.permissions';
import { useAuthZ } from 'hooks/useAuthZ/useAuthZ';
import { RoleType } from 'types/roles';

import type { RoleDetailsDrawerProps } from './RoleDetailsDrawer.types';

interface UseRoleDetailsDrawerCallbacksResult {
	role: AuthtypesRoleWithTransactionGroupsDTO | undefined;
	isLoading: boolean;
	isAuthZLoading: boolean;
	isError: boolean;
	error: ErrorType<RenderErrorResponseDTO> | null;
	isManaged: boolean;
	hasReadPermission: boolean;
	hasUpdatePermission: boolean;
	hasDeletePermission: boolean;
	isEditDisabled: boolean;
	editDisabledReason: string;
	handleViewDetails: () => void;
	permissions: ReturnType<typeof useAuthZ>['permissions'];
}

export function useRoleDetailsDrawerCallbacks(
	props: Pick<RoleDetailsDrawerProps, 'roleId' | 'roleName'>,
): UseRoleDetailsDrawerCallbacksResult {
	const { roleId, roleName } = props;
	const history = useHistory();

	const permissionsToCheck = useMemo(() => {
		if (!roleName) {
			return [];
		}
		return [
			buildRoleReadPermission(roleName),
			buildRoleUpdatePermission(roleName),
			buildRoleDeletePermission(roleName),
		];
	}, [roleName]);

	const { permissions, isLoading: isAuthZLoading } =
		useAuthZ(permissionsToCheck);

	const hasReadPermission = useMemo(() => {
		if (!roleName || permissions === null) {
			return false;
		}
		return permissions[buildRoleReadPermission(roleName)]?.isGranted ?? false;
	}, [permissions, roleName]);

	const hasUpdatePermission = useMemo(() => {
		if (!roleName || permissions === null) {
			return false;
		}
		return permissions[buildRoleUpdatePermission(roleName)]?.isGranted ?? false;
	}, [permissions, roleName]);

	const hasDeletePermission = useMemo(() => {
		if (!roleName || permissions === null) {
			return false;
		}
		return permissions[buildRoleDeletePermission(roleName)]?.isGranted ?? false;
	}, [permissions, roleName]);

	const { data, isLoading, isError, error } = useGetRole(
		{ id: roleId ?? '' },
		{ query: { enabled: !!roleId && hasReadPermission } },
	);

	const role = data?.data;
	const isManaged = role?.type === RoleType.MANAGED;

	const handleViewDetails = useCallback((): void => {
		if (roleId && role?.name) {
			const search = `?name=${encodeURIComponent(role.name)}`;
			history.push(`${ROUTES.ROLE_DETAILS.replace(':roleId', roleId)}${search}`);
		}
	}, [history, roleId, role?.name]);

	const isEditDisabled = isManaged || !hasUpdatePermission;
	const editDisabledReason = isManaged
		? 'Managed roles cannot be edited'
		: 'You do not have permission to edit this role';

	return {
		role,
		isLoading,
		isAuthZLoading,
		isError,
		error,
		isManaged,
		hasReadPermission,
		hasUpdatePermission,
		hasDeletePermission,
		isEditDisabled,
		editDisabledReason,
		handleViewDetails,
		permissions,
	};
}
