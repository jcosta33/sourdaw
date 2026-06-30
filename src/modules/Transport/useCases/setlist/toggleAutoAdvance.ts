import { pushUndoEntry } from '#/modules/Command/useCases';

import { setlistStore } from '../../stores/setlistStore';

export function toggleAutoAdvance(): void {
    const state = setlistStore.value;
    if (!state) {
        return;
    }
    const previous = state.autoAdvance;
    const next = !previous;
    setlistStore.set({ ...state, autoAdvance: next });

    pushUndoEntry(
        next ? 'Enable auto-advance' : 'Disable auto-advance',
        () => {
            const current = setlistStore.value;
            if (!current) {
                return;
            }
            setlistStore.set({ ...current, autoAdvance: previous });
        },
        () => {
            const current = setlistStore.value;
            if (!current) {
                return;
            }
            setlistStore.set({ ...current, autoAdvance: next });
        }
    );
}
