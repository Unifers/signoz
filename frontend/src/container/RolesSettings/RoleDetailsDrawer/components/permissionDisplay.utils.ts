import { ACTION_LABELS, PermissionScope } from '../../types';

export type ScopeBadgeVariant = 'all' | 'none' | 'selected';

export interface ScopeBadge {
	label: string;
	variant: ScopeBadgeVariant;
}

export function getActionLabel(actionName: string): string {
	return ACTION_LABELS[actionName] ?? actionName;
}

export function getScopeBadge(
	scope: PermissionScope,
	selectedCount: number,
): ScopeBadge {
	switch (scope) {
		case PermissionScope.ALL:
			return { label: 'All', variant: 'all' };
		case PermissionScope.ONLY_SELECTED:
			return { label: `Only selected · ${selectedCount}`, variant: 'selected' };
		case PermissionScope.NONE:
		default:
			return { label: 'None', variant: 'none' };
	}
}
