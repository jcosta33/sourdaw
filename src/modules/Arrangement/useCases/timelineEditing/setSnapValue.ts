import { timelineEditingStore } from '../../stores/timelineEditingStore';

export function setSnapValue(value: number): void {
    const state = timelineEditingStore.value;
    if (!state) {
        return;
    }
    timelineEditingStore.set({ ...state, snapValue: value });
}
