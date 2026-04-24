import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';
import { type SoloMode } from '../../workspaceQueries/helpers';

export const setSoloMode = (soloMode: SoloMode): void => {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ soloMode });
};
