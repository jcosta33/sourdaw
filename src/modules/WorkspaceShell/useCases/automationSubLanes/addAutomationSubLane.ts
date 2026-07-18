import { getWorkspaceState } from '../../repositories/getWorkspaceState';

import { setAutomationSubLanes } from './helpers';

export function addAutomationSubLane(trackId: string, paramId: string): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(trackId, [...existing, paramId]);
}
