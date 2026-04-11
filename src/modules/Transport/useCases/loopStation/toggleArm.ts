import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

export function toggleArm(): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }
    loopStationStore.set({ ...state, armed: !state.armed });
}
