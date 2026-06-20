import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const setClipSelection = (clipIds: string[]): void => {
    updateWorkspaceState({ selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
};
