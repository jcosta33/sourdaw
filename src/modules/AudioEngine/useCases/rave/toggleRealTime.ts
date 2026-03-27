import { raveStore } from '#/modules/AudioEngine/stores/rave';

export function toggleRealTime(): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({ ...state, realTimeEnabled: !state.realTimeEnabled });
}
