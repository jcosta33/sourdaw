import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { loopStationStore } from '../../stores/loopStationStore';

export function setFixedLoopLength(beats: number): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = loopStationStore.value;
        if (!state) {
            return;
        }
        const previous = state.fixedLoopLength;
        if (previous === beats) {
            return;
        }
        loopStationStore.set({ ...state, fixedLoopLength: beats });

        pushUndoEntry(
            'Set loop length',
            () => {
                const current = loopStationStore.value;
                if (!current) {
                    return;
                }
                loopStationStore.set({ ...current, fixedLoopLength: previous });
            },
            () => {
                const current = loopStationStore.value;
                if (!current) {
                    return;
                }
                loopStationStore.set({ ...current, fixedLoopLength: beats });
            }
        );
    });
}
