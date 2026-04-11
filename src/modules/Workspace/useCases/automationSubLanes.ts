import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';

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

export function addAutomationSubLane(trackId: string, paramId: string): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(trackId, [...existing, paramId]);
}

export function removeAutomationSubLane(trackId: string, index: number): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(
        trackId,
        existing.filter((_, i) => i !== index)
    );
}

export function swapAutomationSubLaneParam(trackId: string, index: number, newParamId: string): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = [...(current.automationSubLanes[trackId] ?? [])];
    existing[index] = newParamId;
    setAutomationSubLanes(trackId, existing);
}
