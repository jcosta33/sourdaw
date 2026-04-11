import { updateWorkspaceState } from '#/modules/Workspace/useCases';

export function deselectAllClips(): void {
    updateWorkspaceState({ selectedClipIds: [], selectedClipId: null });
}
