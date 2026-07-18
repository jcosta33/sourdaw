import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';
import { type SoloMode } from '../../workspaceQueries/helpers';

export const setSoloMode = (soloMode: SoloMode): void => {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ soloMode });
};
