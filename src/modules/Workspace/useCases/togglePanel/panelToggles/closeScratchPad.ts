import { updateWorkspaceState } from '../../../repositories/workspace';

export function closeScratchPad(): void {
    updateWorkspaceState({ scratchPadOpen: false });
}