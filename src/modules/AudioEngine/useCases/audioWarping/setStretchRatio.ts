import { audioWarpStore, DEFAULT_WARP_SETTINGS } from '#/modules/AudioEngine/stores/audioWarp';

export function setStretchRatio(clipId: string, ratio: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, stretchRatio: Math.max(0.1, Math.min(10, ratio)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
