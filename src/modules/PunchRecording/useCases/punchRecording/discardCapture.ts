import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { punchRecordingStore, type PunchRecordingState } from '../../stores/punchRecordingStore';

export function discardCapture(captureId: string): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = punchRecordingStore.value;
        if (!state) {
            return;
        }
        if (!state.captures.some((c) => c.id === captureId)) {
            return;
        }

        const previous: PunchRecordingState = state;
        const next: PunchRecordingState = {
            ...state,
            captures: state.captures.filter((c) => c.id !== captureId),
        };
        punchRecordingStore.set(next);

        pushUndoEntry(
            'Discard capture',
            () => punchRecordingStore.set(previous),
            () => punchRecordingStore.set(next)
        );
    });
}
