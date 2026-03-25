import { raveStore } from '#/modules/AudioEngine/stores/rave';

export function setTemperature(temp: number): void {
    const state = raveStore.value;
    if (!state) { return; }
    raveStore.set({ ...state, temperature: Math.max(0, Math.min(3, temp)) });
}
