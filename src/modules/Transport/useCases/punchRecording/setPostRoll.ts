import { inject } from '#/infra/di/inject';
import { punchRecordingStore } from '#/modules/Transport/stores/punchRecordingStore';

export const setPostRoll = inject({ punchRecordingStore })(({ punchRecordingStore: store }) => {
    return function setPostRoll(beats: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, defaultPostRoll: beats });
    };
});
