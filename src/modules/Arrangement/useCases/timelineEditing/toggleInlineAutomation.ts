import { timelineEditingStore } from '../../stores/timelineEditingStore';

export function toggleInlineAutomation(): void {
    const state = timelineEditingStore.value;
    if (state) {
        timelineEditingStore.set({
            ...state,
            automationVisibility: state.automationVisibility === 'overlay' ? 'hidden' : 'overlay',
        });
    }
}
