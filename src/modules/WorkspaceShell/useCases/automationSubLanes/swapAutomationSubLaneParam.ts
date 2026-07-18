import { getWorkspaceState } from '../../repositories/getWorkspaceState';

import { setAutomationSubLanes } from './helpers';

export function swapAutomationSubLaneParam(trackId: string, index: number, newParamId: string): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const existing = [...(current.automationSubLanes[trackId] ?? [])];
    existing[index] = newParamId;
    setAutomationSubLanes(trackId, existing);
}
