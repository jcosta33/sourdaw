import { updateWorkspaceState } from '../../../repositories/workspace';

export function selectClip(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId });
}