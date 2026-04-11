import { updateWorkspaceState } from '../../../repositories/workspace';

export function clearClipSelection(): void {
    updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
}