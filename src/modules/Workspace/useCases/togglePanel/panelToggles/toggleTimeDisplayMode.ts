import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleTimeDisplayMode = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({
        timeDisplayMode: current.timeDisplayMode === 'musical' ? 'time' : 'musical',
    });
};
