import { audioWarpStore } from '../../stores/audioWarp';

export function removeWarpMarker(clipId: string, markerId: string): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, markers: settings.markers.filter((message) => message.id !== markerId) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
