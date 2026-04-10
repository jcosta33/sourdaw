import { inject } from '#/infra/di/inject';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export const toggleSync = inject({ loopStationStore })(({ loopStationStore: store }) => {
    return function toggleSync(): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ ...state, syncToTransport: !state.syncToTransport });
    };
});
