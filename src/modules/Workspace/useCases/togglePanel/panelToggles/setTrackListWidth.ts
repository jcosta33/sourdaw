import { updateWorkspaceState } from '../../../repositories/workspace';

export function setTrackListWidth(width: number): void {
    updateWorkspaceState({ trackListWidth: width });
}