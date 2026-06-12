import { updateWorkspaceState } from '../../../repositories/workspace';

export const setClipSelection = (clipIds: string[]): void => {
    updateWorkspaceState({ selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
};
