import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore, type SetlistState } from '../../stores/setlistStore';

export function reorderSetlistItems(fromIndex: number, toIndex: number): void {
    const state = setlistStore.value;
    if (!state || fromIndex === toIndex) {
        return;
    }
    const items = [...state.items];
    const [moved] = items.splice(fromIndex, 1);
    if (!moved) {
        return;
    }
    items.splice(toIndex, 0, moved);

    const previous: SetlistState = state;
    const next: SetlistState = { ...state, items };
    setlistStore.set(next);

    pushUndoEntry(
        'Reorder setlist',
        () => setlistStore.set(previous),
        () => setlistStore.set(next)
    );
}
