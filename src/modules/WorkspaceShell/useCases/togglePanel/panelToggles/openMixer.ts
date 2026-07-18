import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const openMixer = (): void => {
    updateWorkspaceState({ mixerOpen: true });
};
