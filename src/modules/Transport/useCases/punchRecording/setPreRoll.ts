import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const setPreRoll = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function setPreRoll(beats: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, defaultPreRoll: beats });
    };
});
