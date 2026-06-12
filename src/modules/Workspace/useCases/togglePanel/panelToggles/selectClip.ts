import { updateWorkspaceState } from '../../../repositories/workspace';

export const selectClip = (clipId: string): void => {
    updateWorkspaceState({ selectedClipId: clipId });
};
