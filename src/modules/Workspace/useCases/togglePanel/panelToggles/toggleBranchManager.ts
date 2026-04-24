import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleBranchManager = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ branchManagerOpen: !current.branchManagerOpen });
};
