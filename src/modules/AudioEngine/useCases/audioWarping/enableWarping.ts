import { audioWarpStore, DEFAULT_WARP_SETTINGS } from '../../stores/audioWarp';

export function enableWarping(clipId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS, algorithm: state.defaultAlgorithm };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, enabled: true });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
