import { getWorkspaceState } from '../../repositories/workspace';

import { setAutomationSubLanes } from './helpers';

export function removeAutomationSubLane(trackId: string, index: number): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(
        trackId,
        existing.filter((_, index1) => index1 !== index)
    );
}
