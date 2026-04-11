import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleInspector(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
}