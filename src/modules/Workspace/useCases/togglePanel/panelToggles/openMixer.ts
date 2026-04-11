import { updateWorkspaceState } from '../../../repositories/workspace';

export function openMixer(): void {
    updateWorkspaceState({ mixerOpen: true });
}