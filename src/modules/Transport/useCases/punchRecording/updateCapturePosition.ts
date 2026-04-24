import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function updateCapturePosition(captureId: string, currentBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((context) =>
            context.id === captureId ? { ...context, endBeat: currentBeat } : context
        ),
    });
}
