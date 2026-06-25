import { useEffect } from 'react';
import { useStore } from 'zustand';

import { useAccessibleProjects } from './useAccessibleProjects';
import { projectStore, type ProjectStoreApi } from './useCurrentProject';

// Auto-select the first allowed (slug, logType) when none is chosen.
// useAccessibleProjects sorts alphabetically so the choice is
// deterministic and matches existing UX conventions.
export function useProjectAutoSelect(
	store: ProjectStoreApi = projectStore,
): void {
	const accessible = useAccessibleProjects();
	const selection = useStore(store, (s) => s.selection);
	const setSelection = useStore(store, (s) => s.setSelection);

	useEffect(() => {
		if (selection.projectSlug !== null && selection.logType !== null) {
			return;
		}
		if (accessible.isLoading || accessible.data.length === 0) {
			return;
		}
		const first = accessible.data[0];
		setSelection({ projectSlug: first.slug, logType: first.logType });
	}, [accessible.isLoading, accessible.data, selection, setSelection]);
}
