import { updateWorkspaceState } from '../../../repositories/workspace';

export const closeScratchPad = (): void => {
    updateWorkspaceState({ scratchPadOpen: false });
};
