import { timelineEditingStore } from '#/modules/Arrangement/stores';

import { setAutomationSubLanes } from './helpers';

export function addAutomationSubLane(trackId: string, paramId: string): void {
    const current = timelineEditingStore.value;
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(trackId, [...existing, paramId]);
}
