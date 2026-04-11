import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleBranchManager(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ branchManagerOpen: !current.branchManagerOpen });
}