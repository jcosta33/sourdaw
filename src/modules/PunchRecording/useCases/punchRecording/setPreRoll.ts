import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function setPreRoll(beats: number): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = punchRecordingStore.value;
        if (!state) {
            return;
        }
        const previous = state.defaultPreRoll;
        if (previous === beats) {
            return;
        }
        punchRecordingStore.set({ ...state, defaultPreRoll: beats });

        pushUndoEntry(
            'Set punch pre-roll',
            () => {
                const current = punchRecordingStore.value;
                if (!current) {
                    return;
                }
                punchRecordingStore.set({ ...current, defaultPreRoll: previous });
            },
            () => {
                const current = punchRecordingStore.value;
                if (!current) {
                    return;
                }
                punchRecordingStore.set({ ...current, defaultPreRoll: beats });
            }
        );
    });
}
