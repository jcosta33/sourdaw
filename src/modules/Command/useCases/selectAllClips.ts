import { updateWorkspaceState } from '#/modules/Workspace/useCases';
import { getAllClipIds } from './selectionHelpers/getAllClipIds';

export function selectAllClips(): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}
