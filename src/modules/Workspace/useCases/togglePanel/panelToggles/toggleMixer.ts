import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleMixer = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
};
