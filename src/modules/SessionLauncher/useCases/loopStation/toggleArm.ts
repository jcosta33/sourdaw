import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { loopStationStore } from '../../stores/loopStationStore';

export function toggleArm(): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = loopStationStore.value;
        if (!state) {
            return;
        }
        const previous = state.armed;
        const next = !previous;
        loopStationStore.set({ ...state, armed: next });

        pushUndoEntry(
            next ? 'Arm loop station' : 'Disarm loop station',
            () => {
                const current = loopStationStore.value;
                if (!current) {
                    return;
                }
                loopStationStore.set({ ...current, armed: previous });
            },
            () => {
                const current = loopStationStore.value;
                if (!current) {
                    return;
                }
                loopStationStore.set({ ...current, armed: next });
            }
        );
    });
}
