import { updateWorkspaceState } from '../../../repositories/workspace';

export function selectClipWithFocus(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
}