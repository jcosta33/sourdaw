import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleTrackList(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ trackListOpen: !current.trackListOpen });
}