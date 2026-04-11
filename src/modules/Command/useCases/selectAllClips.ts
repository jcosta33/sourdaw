import { updateWorkspaceState } from '#/modules/Workspace/useCases';
import { getAllClipIds } from './selectionHelpers';

export function selectAllClips(): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}
