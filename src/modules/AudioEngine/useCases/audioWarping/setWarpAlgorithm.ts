import { audioWarpStore, DEFAULT_WARP_SETTINGS, type WarpAlgorithm } from '../../stores/audioWarp';

export function setWarpAlgorithm(clipId: string, algorithm: WarpAlgorithm): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, algorithm });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
