import { updateWorkspaceState } from '../../../repositories/workspace';

export const clearClipSelection = (): void => {
    updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
};
