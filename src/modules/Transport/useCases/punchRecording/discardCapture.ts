import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const discardCapture = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function discardCapture(captureId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({
            ...state,
            captures: state.captures.filter((c) => c.id !== captureId),
        });
    };
});
