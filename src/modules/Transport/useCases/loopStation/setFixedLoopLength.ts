import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const setFixedLoopLength = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function setFixedLoopLength(beats: number): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, fixedLoopLength: beats });
    };
});
