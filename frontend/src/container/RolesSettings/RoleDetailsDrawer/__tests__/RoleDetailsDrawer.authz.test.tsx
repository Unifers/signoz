import * as roleApi from 'api/generated/services/role';
import * as useAuthZModule from 'hooks/useAuthZ/useAuthZ';
import { customRoleResponse } from 'mocks-server/__mockdata__/roles';
import {
	mockUseAuthZDenyAll,
	mockUseAuthZGrantAll,
	mockUseAuthZGrantReadOnly,
} from 'tests/authz-test-utils';
import { render, screen } from 'tests/test-utils';

import * as useRolePermissionsModule from '../../useRolePermissions';
import RoleDetailsDrawer from '../RoleDetailsDrawer';

import {
	CUSTOM_ROLE_ID,
	CUSTOM_ROLE_NAME,
	mockPermissionsData,
} from './testUtils';

describe('RoleDetailsDrawer - AuthZ', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('permission denied', () => {
		it('shows permission denied callout when read permission denied', () => {
			jest
				.spyOn(useAuthZModule, 'useAuthZ')
				.mockImplementation(mockUseAuthZDenyAll);

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(screen.getByText(/Permission Denied/i)).toBeInTheDocument();
			expect(
				screen.getByText(/You do not have permission to view this role/i),
			).toBeInTheDocument();
		});
	});

	describe('edit button visibility', () => {
		it('disables Edit button when update permission denied', () => {
			jest
				.spyOn(useAuthZModule, 'useAuthZ')
				.mockImplementation(mockUseAuthZGrantReadOnly);

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: customRoleResponse,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(screen.getByTestId('role-drawer-edit-btn')).toBeDisabled();
		});

		it('shows Edit button when update permission granted', () => {
			jest
				.spyOn(useAuthZModule, 'useAuthZ')
				.mockImplementation(mockUseAuthZGrantAll);

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: customRoleResponse,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			jest.spyOn(useRolePermissionsModule, 'useRolePermissions').mockReturnValue({
				data: mockPermissionsData,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof useRolePermissionsModule.useRolePermissions>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(screen.getByTestId('role-drawer-edit-btn')).toBeInTheDocument();
		});
	});

	describe('delete button visibility', () => {
		it('disables Delete button when delete permission denied', () => {
			jest
				.spyOn(useAuthZModule, 'useAuthZ')
				.mockImplementation(mockUseAuthZGrantReadOnly);

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: customRoleResponse,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(screen.getByTestId('role-drawer-delete-btn')).toBeDisabled();
		});

		it('enables Delete button when delete permission granted', () => {
			jest
				.spyOn(useAuthZModule, 'useAuthZ')
				.mockImplementation(mockUseAuthZGrantAll);

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: customRoleResponse,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			jest.spyOn(useRolePermissionsModule, 'useRolePermissions').mockReturnValue({
				data: mockPermissionsData,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof useRolePermissionsModule.useRolePermissions>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(screen.getByTestId('role-drawer-delete-btn')).not.toBeDisabled();
		});
	});

	describe('loading state', () => {
		it('shows skeleton while checking permissions', () => {
			jest.spyOn(useAuthZModule, 'useAuthZ').mockReturnValue({
				isLoading: true,
				isFetching: true,
				error: null,
				permissions: null,
				refetchPermissions: jest.fn(),
			});

			jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
				error: null,
			} as ReturnType<typeof roleApi.useGetRole>);

			render(
				<RoleDetailsDrawer
					roleId={CUSTOM_ROLE_ID}
					roleName={CUSTOM_ROLE_NAME}
					onClose={jest.fn()}
				/>,
				undefined,
				{ initialRoute: '/settings/roles' },
			);

			expect(document.querySelector('.ant-skeleton')).toBeInTheDocument();
		});
	});
});
