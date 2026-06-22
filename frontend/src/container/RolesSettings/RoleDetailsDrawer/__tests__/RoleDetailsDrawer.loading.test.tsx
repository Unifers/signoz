import * as roleApi from 'api/generated/services/role';
import * as useAuthZModule from 'hooks/useAuthZ/useAuthZ';
import { mockUseAuthZGrantAll } from 'tests/authz-test-utils';
import { render } from 'tests/test-utils';

import RoleDetailsDrawer from '../RoleDetailsDrawer';

import { CUSTOM_ROLE_ID, CUSTOM_ROLE_NAME } from './testUtils';

describe('RoleDetailsDrawer - Loading State', () => {
	beforeEach(() => {
		jest
			.spyOn(useAuthZModule, 'useAuthZ')
			.mockImplementation(mockUseAuthZGrantAll);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows skeleton while fetching role', () => {
		jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
			data: undefined,
			isLoading: true,
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
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(document.querySelector('.ant-skeleton')).toBeInTheDocument();
	});

	it('does not fetch when roleId is null', () => {
		const getRole = jest.spyOn(roleApi, 'useGetRole');

		render(
			<RoleDetailsDrawer roleId={null} roleName={null} onClose={jest.fn()} />,
			undefined,
			{
				initialRoute: '/settings/roles',
			},
		);

		expect(getRole).toHaveBeenCalledWith(
			{ id: '' },
			expect.objectContaining({ query: { enabled: false } }),
		);
	});
});
