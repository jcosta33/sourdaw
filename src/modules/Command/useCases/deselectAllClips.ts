/**
 * Selection-mutation use case: clear the clip selection.
 *
 * Lives in useCases because it performs writes via Workspace's public use-case
 * boundary, which is not permitted in the models layer.
 */
import { inject } from '#/infra/di/inject';
import { updateWorkspaceState } from '#/modules/Workspace';

export const deselectAllClips = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function deselectAllClips(): void {
            updateWorkspaceState({ selectedClipIds: [], selectedClipId: null });
        }
);
