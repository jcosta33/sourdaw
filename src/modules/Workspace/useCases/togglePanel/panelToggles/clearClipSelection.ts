import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const clearClipSelection = (): void => {
    updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
};
