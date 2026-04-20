import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';

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
