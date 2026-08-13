import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeMixer = (): void => {
    updateWorkspaceState({ mixerOpen: false });
};
