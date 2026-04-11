import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleMixer(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
}