import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';
import { type SoloMode } from '../../workspaceQueries/helpers';

export function setSoloMode(soloMode: SoloMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ soloMode });
}