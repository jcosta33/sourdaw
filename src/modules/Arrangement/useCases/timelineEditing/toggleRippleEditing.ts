import { timelineEditingStore } from '../../stores/timelineEditingStore';

export function toggleRippleEditing(): void {
    const state = timelineEditingStore.value;
    if (!state) {
        return;
    }
    timelineEditingStore.set({ ...state, rippleEditing: !state.rippleEditing });
}
