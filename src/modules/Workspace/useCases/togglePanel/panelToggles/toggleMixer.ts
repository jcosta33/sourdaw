import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleMixer = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
};
