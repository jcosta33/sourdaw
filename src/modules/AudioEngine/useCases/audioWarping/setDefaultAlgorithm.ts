import { audioWarpStore, type WarpAlgorithm } from '#/modules/AudioEngine/stores/audioWarp';

export function setDefaultAlgorithm(algorithm: WarpAlgorithm): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    audioWarpStore.set({ ...state, defaultAlgorithm: algorithm });
}
