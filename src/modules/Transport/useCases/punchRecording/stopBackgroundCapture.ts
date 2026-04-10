import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const stopBackgroundCapture = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function stopBackgroundCapture(captureId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            captures: state.captures.map((c) => (c.id === captureId ? { ...c, recording: false } : c)),
        });
    };
});
