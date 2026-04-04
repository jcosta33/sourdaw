/**
 * Edit action handlers — business logic for selection-mutation edit commands.
 *
 * These live in useCases because they perform writes (via Workspace's public
 * use-case boundary), which is not permitted in the models layer.
 */
import { getAllClipIds } from './selectionHelpers';
import { updateWorkspaceState } from '#/modules/Workspace/useCases/workspaceState';

/** Select every clip on the timeline. */
export function selectAllClips(): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}

/** Clear the clip selection. */
export function deselectAllClips(): void {
    updateWorkspaceState({ selectedClipIds: [], selectedClipId: null });
}
