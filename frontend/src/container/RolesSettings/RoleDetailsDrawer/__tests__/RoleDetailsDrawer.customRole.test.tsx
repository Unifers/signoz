import { render, screen } from 'tests/test-utils';

import RoleDetailsDrawer from '../RoleDetailsDrawer';

import {
	CUSTOM_ROLE_ID,
	CUSTOM_ROLE_NAME,
	mockHooksForCustomRole,
} from './testUtils';

describe('RoleDetailsDrawer - Custom Role', () => {
	beforeEach(() => {
		mockHooksForCustomRole();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('renders role name in drawer title', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByText('billing-manager')).toBeInTheDocument();
	});

	it('displays Custom badge for custom roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByText('Custom')).toBeInTheDocument();
	});

	it('shows role description', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(
			screen.getByText('Custom role for managing billing and invoices.'),
		).toBeInTheDocument();
	});

	it('shows Edit button for custom roles', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByTestId('role-drawer-edit-btn')).toBeInTheDocument();
	});

	it('shows Close button', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByTestId('role-drawer-close-btn')).toBeInTheDocument();
	});

	it('renders created/updated timestamps labels', () => {
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(screen.getByText('Created At')).toBeInTheDocument();
		expect(screen.getByText('Updated At')).toBeInTheDocument();
	});
});
