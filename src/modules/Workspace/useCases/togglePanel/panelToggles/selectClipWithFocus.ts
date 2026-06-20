import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const selectClipWithFocus = (clipId: string): void => {
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
};
