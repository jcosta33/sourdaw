import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore, type SetlistItem, type SetlistState } from '../../stores/setlistStore';

export function updateSetlistItem(id: string, updates: Partial<Omit<SetlistItem, 'id'>>): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const existing = state.items.find((i) => i.id === id);
    if (!existing) {
        return;
    }

    const previous: SetlistState = state;
    const next: SetlistState = {
        ...state,
        items: state.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
    };
    setlistStore.set(next);

    pushUndoEntry(
        `Update setlist item: ${existing.name}`,
        () => setlistStore.set(previous),
        () => setlistStore.set(next)
    );
}
