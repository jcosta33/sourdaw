import { pushUndoEntry } from '#/modules/Command/useCases';

import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function setPostRoll(beats: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    const previous = state.defaultPostRoll;
    if (previous === beats) {
        return;
    }
    punchRecordingStore.set({ ...state, defaultPostRoll: beats });

    pushUndoEntry(
        'Set punch post-roll',
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, defaultPostRoll: previous });
        },
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, defaultPostRoll: beats });
        }
    );
}
