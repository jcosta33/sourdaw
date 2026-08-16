import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore, type SetlistState } from '../../stores/setlistStore';

export function removeSetlistItem(id: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const removedIndex = state.items.findIndex((i) => i.id === id);
    const removed = state.items[removedIndex];
    if (!removed) {
        return;
    }
    const items = state.items.filter((i) => i.id !== id);

    // `currentIndex` is a position, not an identity: dropping a song shifts every
    // later song down one slot, so an untouched index silently re-points the live
    // cursor at the neighbour (and runs off the end when the last song goes).
    // Keep it on the same song, and clamp into the shortened list otherwise.
    let currentIndex = state.currentIndex;
    if (removedIndex < currentIndex) {
        currentIndex -= 1;
    }
    if (currentIndex > items.length - 1) {
        currentIndex = items.length - 1;
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }

    const previous: SetlistState = state;
    const next: SetlistState = {
        ...state,
        items,
        currentIndex,
    };
    setlistStore.set(next);

    pushUndoEntry(
        `Remove setlist item: ${removed.name}`,
        () => setlistStore.set(previous),
        () => setlistStore.set(next)
    );
}
