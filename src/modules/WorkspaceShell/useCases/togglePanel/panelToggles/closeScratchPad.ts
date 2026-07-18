import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeScratchPad = (): void => {
    updateWorkspaceState({ scratchPadOpen: false });
};
