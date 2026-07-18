import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeBranchManager = (): void => {
    updateWorkspaceState({ branchManagerOpen: false });
};
