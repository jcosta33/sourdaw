import { updateWorkspaceState } from '../../../repositories/workspace';

export const selectAllClips = (getAllClipIds: () => string[]): void => {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
};
