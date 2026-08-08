import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore, type SetlistState } from '../../stores/setlistStore';

export function reorderSetlistItems(fromIndex: number, toIndex: number): void {
    const state = setlistStore.value;
    if (!state || fromIndex === toIndex) {
        return;
    }
    const items = [...state.items];
    const currentItem = state.items[state.currentIndex];
    const [moved] = items.splice(fromIndex, 1);
    if (!moved) {
        return;
    }
    items.splice(toIndex, 0, moved);

    // `currentIndex` is a position, not an identity. Re-derive it from the song it
    // pointed at, or the live cursor lands on whatever song the drag left in that
    // slot — including when the dragged song is the one currently playing.
    const relocated = currentItem ? items.findIndex((entry) => entry.id === currentItem.id) : -1;
    const currentIndex = relocated === -1 ? state.currentIndex : relocated;

    const previous: SetlistState = state;
    const next: SetlistState = { ...state, items, currentIndex };
    setlistStore.set(next);

    pushUndoEntry(
        'Reorder setlist',
        () => setlistStore.set(previous),
        () => setlistStore.set(next)
    );
}
