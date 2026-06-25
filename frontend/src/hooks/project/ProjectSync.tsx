import { useProjectAutoSelect } from './useProjectAutoSelect';

// ProjectSync wires the side-effects that need a React tree to run.
// Currently: auto-select the first accessible (slug, logType) when none
// is chosen. Renders nothing.
function ProjectSync(): null {
	useProjectAutoSelect();
	return null;
}

export default ProjectSync;
