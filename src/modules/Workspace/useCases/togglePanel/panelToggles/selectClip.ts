import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const selectClip = (clipId: string): void => {
    updateWorkspaceState({ selectedClipId: clipId });
};
