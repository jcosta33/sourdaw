import { updateWorkspaceState } from '../../../repositories/workspace';

export const selectClipWithFocus = (clipId: string): void => {
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
};
