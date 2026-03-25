import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export function toggleSync(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, syncToTransport: !state.syncToTransport });
}
