import { getWorkspaceState } from '../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../repositories/updateWorkspaceState';

export function setAutomationSubLanes(trackId: string, paramIds: string[]): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({
        automationSubLanes: {
            ...current.automationSubLanes,
            [trackId]: paramIds,
        },
    });
}
