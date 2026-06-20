import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const selectAllClips = (getAllClipIds: () => string[]): void => {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
};
