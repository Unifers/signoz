import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
	EMPTY_PROJECT_SELECTION,
	ProjectProvider,
	projectStore,
	useCurrentProject,
} from './useCurrentProject';

const setCurrentProjectHeaderMock = jest.fn();

jest.mock('api', () => ({
	setCurrentProjectHeader: (value: string): void =>
		setCurrentProjectHeaderMock(value),
}));

describe('useCurrentProject', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		projectStore.setState({
			...projectStore.getState(),
			selection: EMPTY_PROJECT_SELECTION,
		});
	});

	it('uses ProjectProvider initial selection to seed the shared store', () => {
		const initial = { projectSlug: 'alpha', logType: 'application' as const };

		const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
			<ProjectProvider initial={initial}>{children}</ProjectProvider>
		);

		const { result } = renderHook(() => useCurrentProject(), { wrapper });

		expect(result.current.selection).toStrictEqual(initial);
		expect(projectStore.getState().selection).toStrictEqual(initial);
		expect(setCurrentProjectHeaderMock).toHaveBeenCalledWith('alpha:application');
	});
});
