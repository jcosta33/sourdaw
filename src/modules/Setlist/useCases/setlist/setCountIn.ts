import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { setlistStore } from '../../stores/setlistStore';

export function setCountIn(bars: number): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = setlistStore.value;
        if (!state) {
            return;
        }
        const previous = state.countInBars;
        if (previous === bars) {
            return;
        }
        setlistStore.set({ ...state, countInBars: bars });

        pushUndoEntry(
            'Set count-in bars',
            () => {
                const current = setlistStore.value;
                if (!current) {
                    return;
                }
                setlistStore.set({ ...current, countInBars: previous });
            },
            () => {
                const current = setlistStore.value;
                if (!current) {
                    return;
                }
                setlistStore.set({ ...current, countInBars: bars });
            }
        );
    });
}
