import { audioWarpStore, DEFAULT_WARP_SETTINGS } from '#/modules/AudioEngine/stores/audioWarp';

export function setFormantPreservation(clipId: string, amount: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, formantPreservation: Math.max(0, Math.min(1, amount)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
