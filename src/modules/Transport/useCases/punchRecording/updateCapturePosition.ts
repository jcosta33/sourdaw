import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const updateCapturePosition = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function updateCapturePosition(captureId: string, currentBeat: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            captures: state.captures.map((c) => (c.id === captureId ? { ...c, endBeat: currentBeat } : c)),
        });
    };
});
