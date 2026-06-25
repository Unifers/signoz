import { Fragment, createElement, useEffect, type ReactNode } from 'react';
import { createStore, type StoreApi } from 'zustand';
import { useStore } from 'zustand';
import type { ProjectLogType } from 'types/api/v1/projects';

import { setCurrentProjectHeader } from 'api';

export type ProjectSelection = {
	projectSlug: string | null;
	logType: ProjectLogType | null;
};

export const EMPTY_PROJECT_SELECTION: ProjectSelection = {
	projectSlug: null,
	logType: null,
};

export type ProjectStore = {
	selection: ProjectSelection;
	setSelection: (next: ProjectSelection) => void;
};

export type ProjectStoreApi = StoreApi<ProjectStore>;

// headerValue encodes the active (slug, logType) for the axios interceptor.
// Returns empty string when no project is selected so the interceptor
// leaves the X-Signoz-Project header unset.
function headerValue(selection: ProjectSelection): string {
	if (!selection.projectSlug || !selection.logType) {
		return '';
	}
	return `${selection.projectSlug}:${selection.logType}`;
}

export const projectStore: ProjectStoreApi = createStore<ProjectStore>(
	(set) => ({
		selection: EMPTY_PROJECT_SELECTION,
		setSelection: (next): void => {
			set({ selection: next });
			setCurrentProjectHeader(headerValue(next));
		},
	}),
);

export function ProjectProvider({
	children,
	initial,
}: {
	children: ReactNode;
	initial?: ProjectSelection;
}): JSX.Element {
	useEffect(() => {
		if (initial) {
			projectStore.getState().setSelection(initial);
			return;
		}

		setCurrentProjectHeader(headerValue(projectStore.getState().selection));
	}, [initial]);

	return createElement(Fragment, null, children);
}

/**
 * Access current project state with optional selector.
 *
 * Calling without a selector returns `{ selection, setSelection }` for
 * convenience and matches the pre-Zustand Context API used by callers
 * like `ProjectSelector`.
 */
export function useCurrentProject<
	T = {
		selection: ProjectSelection;
		setSelection: ProjectStore['setSelection'];
	},
>(selector?: (state: ProjectStore) => T): T {
	return useStore(projectStore, selector ?? ((state) => state as unknown as T));
}

// Standalone imperative accessor — use this outside React (interceptors, etc.).
export function getCurrentProject(): ProjectSelection {
	return projectStore.getState().selection;
}
