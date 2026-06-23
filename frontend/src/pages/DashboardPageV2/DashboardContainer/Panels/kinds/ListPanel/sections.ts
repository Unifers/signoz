import type { SectionConfig } from '../../types/sections';

// List columns are edited below the query builder, not in the config pane, so
// only Context Links shows here.
export const sections: SectionConfig[] = [
	{ kind: 'visualization', controls: { switchPanelKind: true } },
	{ kind: 'contextLinks' },
];
