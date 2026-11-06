import { timelineEditingStore } from '../../stores/timelineEditingStore';

export function setAutomationSubLanes(trackId: string, paramIds: string[]): void {
    const state = timelineEditingStore.value;
    if (!state) {
        return;
    }
    timelineEditingStore.set({
        ...state,
        automationSubLanes: {
            ...state.automationSubLanes,
            [trackId]: paramIds,
        },
    });
}
