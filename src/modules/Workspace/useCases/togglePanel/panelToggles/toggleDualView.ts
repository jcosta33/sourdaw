import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleDualView = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ dualViewOpen: !current.dualViewOpen });
};
