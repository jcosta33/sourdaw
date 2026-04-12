import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function stopBackgroundCapture(captureId: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.map((c) => (c.id === captureId ? { ...c, recording: false } : c)),
    });
}
