import { useState } from 'react';
import { Route, Switch } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import * as roleApi from 'api/generated/services/role';
import { render, screen, waitFor, within } from 'tests/test-utils';

import RoleDetailsDrawer from '../RoleDetailsDrawer';

import {
	CUSTOM_ROLE_ID,
	CUSTOM_ROLE_NAME,
	mockHooksForCustomRole,
} from './testUtils';

describe('RoleDetailsDrawer - Actions', () => {
	beforeEach(() => {
		mockHooksForCustomRole();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('calls onClose when Close button clicked', async () => {
		const user = userEvent.setup();
		const onClose = jest.fn();
		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={onClose}
			/>,
		);

		const closeBtn = screen.getByTestId('role-drawer-close-btn');
		await user.click(closeBtn);

		await waitFor(() => {
			expect(onClose).toHaveBeenCalled();
		});
	});

	it('navigates to edit page when Edit clicked', async () => {
		const user = userEvent.setup();

		render(
			<Switch>
				<Route path="/settings/roles/:roleId">
					<div data-testid="edit-page-target" />
				</Route>
				<Route path="/">
					<RoleDetailsDrawer
						roleId={CUSTOM_ROLE_ID}
						roleName={CUSTOM_ROLE_NAME}
						onClose={jest.fn()}
					/>
				</Route>
			</Switch>,
			undefined,
			{ initialRoute: '/' },
		);

		const editBtn = screen.getByTestId('role-drawer-edit-btn');
		await user.click(editBtn);

		await expect(
			screen.findByTestId('edit-page-target'),
		).resolves.toBeInTheDocument();
	});

	it('opens delete modal when Delete clicked', async () => {
		const user = userEvent.setup();

		render(
			<RoleDetailsDrawer
				roleId={CUSTOM_ROLE_ID}
				roleName={CUSTOM_ROLE_NAME}
				onClose={jest.fn()}
			/>,
		);

		const deleteBtn = screen.getByTestId('role-drawer-delete-btn');
		await user.click(deleteBtn);

		await waitFor(() => {
			expect(
				screen.getByText(/Are you sure you want to delete the role/),
			).toBeInTheDocument();
		});
	});

	it('calls delete API with captured roleId even if drawer closes before confirm', async () => {
		const user = userEvent.setup();

		const mockDeleteRole = jest.fn().mockResolvedValue({});
		jest.spyOn(roleApi, 'useDeleteRole').mockReturnValue({
			mutateAsync: mockDeleteRole,
		} as unknown as ReturnType<typeof roleApi.useDeleteRole>);

		let clearRoleId: (() => void) | undefined;

		function TestWrapper(): JSX.Element {
			const [roleId, setRoleId] = useState<string | null>(CUSTOM_ROLE_ID);
			const [roleName, setRoleName] = useState<string | null>(CUSTOM_ROLE_NAME);

			clearRoleId = (): void => {
				setRoleId(null);
				setRoleName(null);
			};

			return (
				<RoleDetailsDrawer
					roleId={roleId}
					roleName={roleName}
					onClose={jest.fn()}
				/>
			);
		}

		render(<TestWrapper />);

		await user.click(screen.getByTestId('role-drawer-delete-btn'));

		await waitFor(() => {
			expect(
				screen.getByText(/Are you sure you want to delete the role/),
			).toBeInTheDocument();
		});

		clearRoleId?.();

		await waitFor(() => {
			expect(
				screen.getByText(/Are you sure you want to delete the role/),
			).toBeInTheDocument();
		});

		const modal = screen.getByRole('dialog');
		const modalConfirmBtn = within(modal).getByRole('button', {
			name: /Delete Role/i,
		});
		await user.click(modalConfirmBtn);

		await waitFor(() => {
			expect(mockDeleteRole).toHaveBeenCalledWith({
				pathParams: { id: CUSTOM_ROLE_ID },
			});
		});
	});
});
