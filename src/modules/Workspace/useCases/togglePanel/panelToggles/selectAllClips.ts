import { updateWorkspaceState } from '../../../repositories/workspace';

export function selectAllClips(getAllClipIds: () => string[]): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}