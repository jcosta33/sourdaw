import { audioWarpStore } from '#/modules/AudioEngine/stores/audioWarp';

export function disableWarping(clipId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, enabled: false });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
