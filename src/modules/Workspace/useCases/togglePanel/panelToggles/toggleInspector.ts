import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleInspector = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
};
