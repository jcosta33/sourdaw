/**
 * Selection-mutation use case: select every clip on the timeline.
 *
 * Lives in useCases because it performs writes via Workspace's public use-case
 * boundary, which is not permitted in the models layer.
 */
import { inject } from '#/infra/di/inject';
import { updateWorkspaceState } from '#/modules/Workspace/useCases';
import { getAllClipIds } from './selectionHelpers';

export const selectAllClips = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function selectAllClips(): void {
            updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
        }
);
