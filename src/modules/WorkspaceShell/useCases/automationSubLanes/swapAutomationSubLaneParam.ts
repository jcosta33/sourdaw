import { timelineEditingStore } from '#/modules/Arrangement/stores';

import { setAutomationSubLanes } from './helpers';

export function swapAutomationSubLaneParam(trackId: string, index: number, newParamId: string): void {
    const current = timelineEditingStore.value;
    if (!current) {
        return;
    }
    const existing = [...(current.automationSubLanes[trackId] ?? [])];
    existing[index] = newParamId;
    setAutomationSubLanes(trackId, existing);
}
