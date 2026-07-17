import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore } from '../../stores/setlistStore';

export function renameSetlist(name: string): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const previous = state.name;
    if (previous === name) {
        return;
    }
    setlistStore.set({ ...state, name });

    pushUndoEntry(
        `Rename setlist: ${name}`,
        () => {
            const current = setlistStore.value;
            if (!current) {
                return;
            }
            setlistStore.set({ ...current, name: previous });
        },
        () => {
            const current = setlistStore.value;
            if (!current) {
                return;
            }
            setlistStore.set({ ...current, name });
        }
    );
}
