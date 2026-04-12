import { setlistStore } from '../../stores/setlistStore';

export function reorderSetlistItems(fromIndex: number, toIndex: number): void {
    const state = setlistStore.value;
    if (!state || fromIndex === toIndex) {
        return;
    }
    const items = [...state.items];
    const [moved] = items.splice(fromIndex, 1);
    if (moved) {
        items.splice(toIndex, 0, moved);
    }
    setlistStore.set({ ...state, items });
}
