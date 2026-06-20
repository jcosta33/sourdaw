import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleTimeDisplayMode = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({
        timeDisplayMode: current.timeDisplayMode === 'musical' ? 'time' : 'musical',
    });
};
