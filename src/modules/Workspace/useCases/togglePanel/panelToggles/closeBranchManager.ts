import { updateWorkspaceState } from '../../../repositories/workspace';

export const closeBranchManager = (): void => {
    updateWorkspaceState({ branchManagerOpen: false });
};
