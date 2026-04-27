import { updateWorkspaceState } from '../../../repositories/workspace';

export const openMixer = (): void => {
    updateWorkspaceState({ mixerOpen: true });
};
