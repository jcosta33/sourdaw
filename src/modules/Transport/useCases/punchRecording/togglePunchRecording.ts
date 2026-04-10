import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const togglePunchRecording = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function togglePunchRecording(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, enabled: !state.enabled });
    };
});
