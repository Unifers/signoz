import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from 'tests/test-utils';
import MetricsApplication from './MetricsApplication';

// The page reads the URL's :servicename param and then renders tabs only
// when the user is allowed to access that service. We mock the supporting
// hooks/components so the test isolates the access-check decision.

const mockUseServicesList = jest.fn();
const mockUseGetMyUser = jest.fn();
const mockPush = jest.fn();

jest.mock('hooks/useServicesList', () => ({
	useServicesList: (): unknown => mockUseServicesList(),
}));

jest.mock('api/generated/services/users', () => ({
	useGetMyUser: (): unknown => mockUseGetMyUser(),
}));

jest.mock('react-router-dom', () => ({
	...jest.requireActual('react-router-dom'),
	useHistory: (): { push: jest.Mock } => ({ push: mockPush }),
	useParams: (): { servicename: string } => ({ servicename: 'Arka' }),
}));

jest.mock('pages/MetricsApplication/useMetricsApplicationTabKey', () => ({
	__esModule: true,
	default: (): string => 'OVER_METRICS',
}));

jest.mock('container/ResourceAttributesFilter', () => ({
	__esModule: true,
	default: (): null => null,
}));

jest.mock('pages/MetricsApplication/ApDex/ApDexApplication', () => ({
	__esModule: true,
	default: (): null => null,
}));

jest.mock('container/MetricsApplication/Tabs/Overview', () => ({
	__esModule: true,
	default: (): JSX.Element => <div data-testid="tab-overview" />,
}));

jest.mock('container/MetricsApplication/Tabs/DBCall', () => ({
	__esModule: true,
	default: (): JSX.Element => <div data-testid="tab-dbcall" />,
}));

jest.mock('container/MetricsApplication/Tabs/External', () => ({
	__esModule: true,
	default: (): JSX.Element => <div data-testid="tab-external" />,
}));

describe('MetricsApplication - service access check', () => {
	beforeEach(() => {
		mockPush.mockClear();
		mockUseGetMyUser.mockReturnValue({
			data: undefined,
			isLoading: false,
		});
	});

	it('renders the tabs when the user is allowed to access the service', () => {
		mockUseServicesList.mockReturnValue({
			data: ['traky-api', 'Arka'],
			isLoading: false,
		});

		render(<MetricsApplication />, undefined, { initialRoute: '/services/Arka' });

		expect(screen.queryByTestId('service-access-denied-banner')).toBeNull();
		expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
	});

	it('renders a forbidden state when the service is not in the allowed list', async () => {
		mockUseServicesList.mockReturnValue({
			data: ['traky-api'],
			isLoading: false,
		});

		render(<MetricsApplication />, undefined, { initialRoute: '/services/Arka' });

		await waitFor(() => {
			expect(
				screen.getByTestId('service-access-denied-banner'),
			).toBeInTheDocument();
		});

		expect(
			screen.getByText('You don\'t have access to "Arka"'),
		).toBeInTheDocument();
		expect(screen.queryByTestId('tab-overview')).toBeNull();
	});

	it('navigates back to /services when the back button is clicked', async () => {
		mockUseServicesList.mockReturnValue({
			data: ['traky-api'],
			isLoading: false,
		});

		render(<MetricsApplication />, undefined, { initialRoute: '/services/Arka' });

		const backButton = await screen.findByTestId(
			'service-access-denied-back-button',
		);
		fireEvent.click(backButton);

		expect(mockPush).toHaveBeenCalledWith('/services');
	});

	it('renders a loading skeleton while the allowed services are being fetched', () => {
		mockUseServicesList.mockReturnValue({
			data: undefined,
			isLoading: true,
		});

		render(<MetricsApplication />, undefined, { initialRoute: '/services/Arka' });

		expect(screen.getByTestId('metrics-application-loading')).toBeInTheDocument();
		expect(screen.queryByTestId('service-access-denied-banner')).toBeNull();
		expect(screen.queryByTestId('tab-overview')).toBeNull();
	});

	it('does not deny access when the services list fails to load (fail-open)', () => {
		// Simulates a transient backend error: the hook returns no data and
		// isLoading is false. We must NOT false-positive 403 in this case.
		mockUseServicesList.mockReturnValue({
			data: undefined,
			isLoading: false,
			error: new Error('network down'),
		});

		render(<MetricsApplication />, undefined, { initialRoute: '/services/Arka' });

		expect(screen.queryByTestId('service-access-denied-banner')).toBeNull();
		expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
	});

	describe('External APIs tab access control', () => {
		beforeEach(() => {
			mockUseServicesList.mockReturnValue({
				data: ['Arka'],
				isLoading: false,
			});
		});

		it('renders External tab when user has a managed role', () => {
			mockUseGetMyUser.mockReturnValue({
				data: {
					data: {
						userRoles: [
							{
								role: {
									type: 'managed',
									name: 'Viewer',
								},
							},
						],
					},
				},
			});

			render(<MetricsApplication />, undefined, {
				initialRoute: '/services/Arka',
			});

			expect(screen.getByText('External Metrics')).toBeInTheDocument();
		});

		it('renders External tab when custom role has read access for the service', () => {
			mockUseGetMyUser.mockReturnValue({
				data: {
					data: {
						userRoles: [
							{
								role: {
									type: 'custom',
									name: 'CustomRole',
									description:
										'Desc [signoz_metadata:{"projectPermissions":[{"project":"Arka","externalApi":"read"}]}]',
								},
							},
						],
					},
				},
			});

			render(<MetricsApplication />, undefined, {
				initialRoute: '/services/Arka',
			});

			expect(screen.getByText('External Metrics')).toBeInTheDocument();
		});

		it('renders External tab when custom role has read access for All Services', () => {
			mockUseGetMyUser.mockReturnValue({
				data: {
					data: {
						userRoles: [
							{
								role: {
									type: 'custom',
									name: 'CustomRole',
									description:
										'Desc [signoz_metadata:{"projectPermissions":[{"project":"All Services","externalApi":"read"}]}]',
								},
							},
						],
					},
				},
			});

			render(<MetricsApplication />, undefined, {
				initialRoute: '/services/Arka',
			});

			expect(screen.getByText('External Metrics')).toBeInTheDocument();
		});

		it('hides External tab when custom role has externalApi: none for the service', () => {
			mockUseGetMyUser.mockReturnValue({
				data: {
					data: {
						userRoles: [
							{
								role: {
									type: 'custom',
									name: 'CustomRole',
									description:
										'Desc [signoz_metadata:{"projectPermissions":[{"project":"Arka","externalApi":"none"}]}]',
								},
							},
						],
					},
				},
			});

			render(<MetricsApplication />, undefined, {
				initialRoute: '/services/Arka',
			});

			expect(screen.queryByText('External Metrics')).toBeNull();
		});
	});
});
