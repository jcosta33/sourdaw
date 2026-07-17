import { setlistStore, type SetlistItem } from '../../stores/setlistStore';

export function getCurrentItem(): SetlistItem | null {
    const state = setlistStore.value;
    if (!state || state.items.length === 0) {
        return null;
    }
    return state.items[state.currentIndex] ?? null;
}
