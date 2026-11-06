import { timelineEditingStore } from '#/modules/Arrangement/stores';

import { setAutomationSubLanes } from './helpers';

export function removeAutomationSubLane(trackId: string, index: number): void {
    const current = timelineEditingStore.value;
    if (!current) {
        return;
    }
    const existing = current.automationSubLanes[trackId] ?? [];
    setAutomationSubLanes(
        trackId,
        existing.filter((_, index1) => index1 !== index)
    );
}
