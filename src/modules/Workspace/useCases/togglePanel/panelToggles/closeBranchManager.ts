import { updateWorkspaceState } from '../../../repositories/workspace';

export function closeBranchManager(): void {
    updateWorkspaceState({ branchManagerOpen: false });
}