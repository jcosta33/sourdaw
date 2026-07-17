import { setlistStore } from '../../stores/setlistStore';

export function getRemainingDuration(): number {
    const state = setlistStore.value;
    if (!state) {
        return 0;
    }
    return state.items
        .slice(state.currentIndex)
        .reduce((sum, item) => sum + item.estimatedDuration + item.gapSeconds, 0);
}
