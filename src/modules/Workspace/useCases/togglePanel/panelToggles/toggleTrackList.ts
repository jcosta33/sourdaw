import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleTrackList = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ trackListOpen: !current.trackListOpen });
};
