import * as roleApi from 'api/generated/services/role';
import * as useAuthZModule from 'hooks/useAuthZ/useAuthZ';
import { customRoleResponse } from 'mocks-server/__mockdata__/roles';
import { mockUseAuthZGrantAll } from 'tests/authz-test-utils';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from 'tests/test-utils';

import * as useRolePermissionsModule from '../../useRolePermissions';
import RoleDetailsDrawer from '../RoleDetailsDrawer';

import {
	CUSTOM_ROLE_ID,
	CUSTOM_ROLE_NAME,
	mockHooksForCustomRole,
	mockHooksWithPermissions,
	mockPermissionsData,
} from './testUtils';

describe('RoleDetailsDrawer - Permission Overview', () => {
	beforeEach(() => {
		mockHooksForCustomRole();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('renders Permissions section label', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByText('Permissions')).toBeInTheDocument();
	});

	it('renders permission overview container', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('permission-overview')).toBeInTheDocument();
	});

	it('shows resource permission cards', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(
			screen.getByTestId('resource-section-factor-api-key'),
		).toBeInTheDocument();
		expect(screen.getByTestId('resource-section-role')).toBeInTheDocument();
		expect(
			screen.getByTestId('resource-section-serviceaccount'),
		).toBeInTheDocument();
	});

	it('displays granted count for each resource', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(
			screen.getByTestId('granted-count-factor-api-key'),
		).toBeInTheDocument();
	});
});

describe('RoleDetailsDrawer - Permission Overview Loading State', () => {
	beforeEach(() => {
		jest
			.spyOn(useAuthZModule, 'useAuthZ')
			.mockImplementation(mockUseAuthZGrantAll);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows skeleton when permissions are loading', () => {
		jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
			data: customRoleResponse,
			isLoading: false,
			isError: false,
			error: null,
		} as ReturnType<typeof roleApi.useGetRole>);

		jest.spyOn(useRolePermissionsModule, 'useRolePermissions').mockReturnValue({
			data: undefined,
			isLoading: true,
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

		expect(screen.getByTestId('permission-overview-loading')).toBeInTheDocument();
	});
});

describe('RoleDetailsDrawer - Permission Overview Error State', () => {
	beforeEach(() => {
		jest
			.spyOn(useAuthZModule, 'useAuthZ')
			.mockImplementation(mockUseAuthZGrantAll);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows error when permissions fail to load', () => {
		jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
			data: customRoleResponse,
			isLoading: false,
			isError: false,
			error: null,
		} as ReturnType<typeof roleApi.useGetRole>);

		jest.spyOn(useRolePermissionsModule, 'useRolePermissions').mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error('Failed'),
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

		expect(screen.getByTestId('permission-overview-error')).toBeInTheDocument();
	});
});

describe('RoleDetailsDrawer - Scope: ALL permissions', () => {
	beforeEach(() => {
		jest
			.spyOn(useAuthZModule, 'useAuthZ')
			.mockImplementation(mockUseAuthZGrantAll);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows "All" badge for actions with ALL scope', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'factor-api-key',
					resourceKind: 'factor-api-key',
					resourceType: 'metaresource',
					resourceLabel: 'API Keys',
					actions: {
						read: { scope: 'all', selectedIds: [] },
						create: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['read', 'create'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('scope-badge-read')).toHaveTextContent('All');
		expect(screen.getByTestId('scope-badge-create')).toHaveTextContent('All');
	});

	it('shows full granted count when all actions are ALL', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'role',
					resourceKind: 'role',
					resourceType: 'role',
					resourceLabel: 'Roles',
					actions: {
						read: { scope: 'all', selectedIds: [] },
						create: { scope: 'all', selectedIds: [] },
						update: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['read', 'create', 'update'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('granted-count-role')).toHaveTextContent(
			'3 / 3 granted',
		);
	});
});

describe('RoleDetailsDrawer - Scope: NONE permissions', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows "None" badge for actions with NONE scope', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'serviceaccount',
					resourceKind: 'serviceaccount',
					resourceType: 'serviceaccount',
					resourceLabel: 'Service Accounts',
					actions: {
						read: { scope: 'none', selectedIds: [] },
						delete: { scope: 'none', selectedIds: [] },
					},
					availableActions: ['read', 'delete'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('scope-badge-read')).toHaveTextContent('None');
		expect(screen.getByTestId('scope-badge-delete')).toHaveTextContent('None');
	});

	it('shows zero granted count when all actions are NONE', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'factor-api-key',
					resourceKind: 'factor-api-key',
					resourceType: 'metaresource',
					resourceLabel: 'API Keys',
					actions: {
						read: { scope: 'none', selectedIds: [] },
						create: { scope: 'none', selectedIds: [] },
						update: { scope: 'none', selectedIds: [] },
						delete: { scope: 'none', selectedIds: [] },
					},
					availableActions: ['read', 'create', 'update', 'delete'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('granted-count-factor-api-key')).toHaveTextContent(
			'0 / 4 granted',
		);
	});
});

describe('RoleDetailsDrawer - Scope: ONLY_SELECTED permissions', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows "Only selected" badge with count', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'role',
					resourceKind: 'role',
					resourceType: 'role',
					resourceLabel: 'Roles',
					actions: {
						read: {
							scope: 'only_selected',
							selectedIds: ['admin', 'editor', 'viewer'],
						},
					},
					availableActions: ['read'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('scope-badge-read')).toHaveTextContent(
			'Only selected · 3',
		);
	});

	it('displays selected IDs as expandable chips', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'factor-api-key',
					resourceKind: 'factor-api-key',
					resourceType: 'metaresource',
					resourceLabel: 'API Keys',
					actions: {
						read: {
							scope: 'only_selected',
							selectedIds: ['key-abc-123', 'key-def-456'],
						},
					},
					availableActions: ['read'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByText('key-abc-123')).toBeInTheDocument();
		expect(screen.getByText('key-def-456')).toBeInTheDocument();
	});

	it('counts ONLY_SELECTED as granted in count', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'serviceaccount',
					resourceKind: 'serviceaccount',
					resourceType: 'serviceaccount',
					resourceLabel: 'Service Accounts',
					actions: {
						read: { scope: 'only_selected', selectedIds: ['sa-1'] },
						create: { scope: 'none', selectedIds: [] },
					},
					availableActions: ['read', 'create'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('granted-count-serviceaccount')).toHaveTextContent(
			'1 / 2 granted',
		);
	});

	it('can collapse and expand selected items list', async () => {
		const user = userEvent.setup();

		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'role',
					resourceKind: 'role',
					resourceType: 'role',
					resourceLabel: 'Roles',
					actions: {
						update: {
							scope: 'only_selected',
							selectedIds: ['editor-role'],
						},
					},
					availableActions: ['update'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByText('editor-role')).toBeInTheDocument();

		const toggle = screen.getByTestId('toggle-items-update');
		await user.click(toggle);

		expect(screen.queryByText('editor-role')).not.toBeInTheDocument();

		await user.click(toggle);
		expect(screen.getByText('editor-role')).toBeInTheDocument();
	});
});

describe('RoleDetailsDrawer - Mixed permission scopes', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('renders all three scope types in single resource card', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'factor-api-key',
					resourceKind: 'factor-api-key',
					resourceType: 'metaresource',
					resourceLabel: 'API Keys',
					actions: {
						read: { scope: 'all', selectedIds: [] },
						create: { scope: 'none', selectedIds: [] },
						update: { scope: 'only_selected', selectedIds: ['key-1', 'key-2'] },
						delete: { scope: 'none', selectedIds: [] },
					},
					availableActions: ['read', 'create', 'update', 'delete'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		const section = screen.getByTestId('resource-section-factor-api-key');

		expect(within(section).getByTestId('scope-badge-read')).toHaveTextContent(
			'All',
		);
		expect(within(section).getByTestId('scope-badge-create')).toHaveTextContent(
			'None',
		);
		expect(within(section).getByTestId('scope-badge-update')).toHaveTextContent(
			'Only selected · 2',
		);
		expect(within(section).getByTestId('scope-badge-delete')).toHaveTextContent(
			'None',
		);

		expect(screen.getByTestId('granted-count-factor-api-key')).toHaveTextContent(
			'2 / 4 granted',
		);
	});

	it('renders multiple resources with different scope combinations', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'factor-api-key',
					resourceKind: 'factor-api-key',
					resourceType: 'metaresource',
					resourceLabel: 'API Keys',
					actions: {
						read: { scope: 'all', selectedIds: [] },
						create: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['read', 'create'],
				},
				{
					resourceId: 'role',
					resourceKind: 'role',
					resourceType: 'role',
					resourceLabel: 'Roles',
					actions: {
						read: { scope: 'none', selectedIds: [] },
						create: { scope: 'none', selectedIds: [] },
					},
					availableActions: ['read', 'create'],
				},
				{
					resourceId: 'serviceaccount',
					resourceKind: 'serviceaccount',
					resourceType: 'serviceaccount',
					resourceLabel: 'Service Accounts',
					actions: {
						read: { scope: 'only_selected', selectedIds: ['sa-1'] },
						create: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['read', 'create'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByTestId('granted-count-factor-api-key')).toHaveTextContent(
			'2 / 2 granted',
		);
		expect(screen.getByTestId('granted-count-role')).toHaveTextContent(
			'0 / 2 granted',
		);
		expect(screen.getByTestId('granted-count-serviceaccount')).toHaveTextContent(
			'2 / 2 granted',
		);
	});
});

describe('RoleDetailsDrawer - Unknown resources', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('renders unknown resource with fallback label', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'future-resource',
					resourceKind: 'future-resource',
					resourceType: 'metaresource',
					resourceLabel: 'future-resource',
					actions: {
						read: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['read'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(
			screen.getByTestId('resource-section-future-resource'),
		).toBeInTheDocument();
		expect(screen.getByText('future-resource')).toBeInTheDocument();
	});

	it('shows raw verb name when no label mapping exists', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'test-resource',
					resourceKind: 'test-resource',
					resourceType: 'metaresource',
					resourceLabel: 'Test Resource',
					actions: {
						unknown_action: { scope: 'all', selectedIds: [] },
					},
					availableActions: ['unknown_action'],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(screen.getByText('unknown_action')).toBeInTheDocument();
	});

	it('handles resource with empty actions', () => {
		mockHooksWithPermissions({
			...mockPermissionsData,
			resources: [
				{
					resourceId: 'empty-resource',
					resourceKind: 'empty-resource',
					resourceType: 'metaresource',
					resourceLabel: 'Empty Resource',
					actions: {},
					availableActions: [],
				},
			],
		});

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{ initialRoute: '/settings/roles' },
		);

		expect(
			screen.getByTestId('resource-section-empty-resource'),
		).toBeInTheDocument();
		expect(screen.getByTestId('granted-count-empty-resource')).toHaveTextContent(
			'0 / 0 granted',
		);
	});
});
