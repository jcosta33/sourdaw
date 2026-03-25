import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export function updateCapturePosition(captureId: string, currentBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) =>
            c.id === captureId ? { ...c, endBeat: currentBeat } : c
        ),
    });
}
