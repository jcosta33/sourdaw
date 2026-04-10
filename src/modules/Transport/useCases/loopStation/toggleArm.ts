import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const toggleArm = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function toggleArm(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, armed: !state.armed });
    };
});
