import { render, screen } from 'tests/test-utils';

import RoleDetailsDrawer from '../RoleDetailsDrawer';

import {
	MANAGED_ROLE_ID,
	MANAGED_ROLE_NAME,
	mockHooksForManagedRole,
} from './testUtils';

describe('RoleDetailsDrawer - Managed Role', () => {
	beforeEach(() => {
		mockHooksForManagedRole();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('displays Managed badge for managed roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={MANAGED_ROLE_ID}
				roleName={MANAGED_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByText('Managed')).toBeInTheDocument();
	});

	it('shows warning callout for managed roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={MANAGED_ROLE_ID}
				roleName={MANAGED_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(
			screen.getByText(
				'This is a managed role. Permissions are view-only and cannot be modified.',
			),
		).toBeInTheDocument();
	});

	it('disables Edit button for managed roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={MANAGED_ROLE_ID}
				roleName={MANAGED_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByTestId('role-drawer-edit-btn')).toBeDisabled();
	});

	it('disables Delete button for managed roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={MANAGED_ROLE_ID}
				roleName={MANAGED_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByTestId('role-drawer-delete-btn')).toBeDisabled();
	});

	it('still shows Close button for managed roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={MANAGED_ROLE_ID}
				roleName={MANAGED_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByTestId('role-drawer-close-btn')).toBeInTheDocument();
	});
});
