import { raveStore } from '#/modules/AudioEngine/stores/rave';

export function setTransferBlend(blend: number): void {
    const state = raveStore.value;
    if (!state) {
        return;
    }
    raveStore.set({ ...state, transferBlend: Math.max(0, Math.min(1, blend)) });
}
