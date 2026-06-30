import { pushUndoEntry } from '#/modules/Command/useCases';

import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function togglePunchRecording(): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    const previous = state.enabled;
    const next = !previous;
    punchRecordingStore.set({ ...state, enabled: next });

    pushUndoEntry(
        next ? 'Enable punch recording' : 'Disable punch recording',
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, enabled: previous });
        },
        () => {
            const current = punchRecordingStore.value;
            if (!current) {
                return;
            }
            punchRecordingStore.set({ ...current, enabled: next });
        }
    );
}
