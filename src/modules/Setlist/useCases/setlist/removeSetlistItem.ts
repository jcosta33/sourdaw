import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { setlistStore, type SetlistState } from '../../stores/setlistStore';

export function removeSetlistItem(id: string): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = setlistStore.value;
        if (!state) {
            return;
        }
        const removed = state.items.find((i) => i.id === id);
        if (!removed) {
            return;
        }
        const previous: SetlistState = state;
        const next: SetlistState = {
            ...state,
            items: state.items.filter((i) => i.id !== id),
            totalDuration: state.totalDuration - removed.estimatedDuration,
        };
        setlistStore.set(next);

        pushUndoEntry(
            `Remove setlist item: ${removed.name}`,
            () => setlistStore.set(previous),
            () => setlistStore.set(next)
        );
    });
}
