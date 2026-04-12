import { setlistStore } from '../../stores/setlistStore';

export function removeSetlistItem(id: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const removed = state.items.find((i) => i.id === id);
    setlistStore.set({
        ...state,
        items: state.items.filter((i) => i.id !== id),
        totalDuration: state.totalDuration - (removed?.estimatedDuration ?? 0),
    });
}
