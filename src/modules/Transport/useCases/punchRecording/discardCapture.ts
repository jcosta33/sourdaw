import { punchRecordingStore } from '../../stores/punchRecordingStore';

export function discardCapture(captureId: string): void {
    const state = punchRecordingStore.value;
    if (!state) {
        return;
    }
    punchRecordingStore.set({
        ...state,
        captures: state.captures.filter((context) => context.id !== captureId),
    });
}
