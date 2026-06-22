import * as roleApi from 'api/generated/services/role';
import * as useAuthZModule from 'hooks/useAuthZ/useAuthZ';
import { mockUseAuthZGrantAll } from 'tests/authz-test-utils';
import { render } from 'tests/test-utils';

import RoleDetailsDrawer from '../RoleDetailsDrawer';

import { CUSTOM_ROLE_ID, CUSTOM_ROLE_NAME } from './testUtils';

describe('RoleDetailsDrawer - Error State', () => {
	beforeEach(() => {
		jest
			.spyOn(useAuthZModule, 'useAuthZ')
			.mockImplementation(mockUseAuthZGrantAll);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('displays error component when API fails', () => {
		jest.spyOn(roleApi, 'useGetRole').mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error('Failed to fetch'),
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

		const errorContainer = document.querySelector('.error-in-place');
		expect(errorContainer).toBeInTheDocument();
	});
});
