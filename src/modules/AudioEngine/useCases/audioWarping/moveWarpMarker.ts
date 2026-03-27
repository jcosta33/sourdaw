import { audioWarpStore } from '#/modules/AudioEngine/stores/audioWarp';

export function moveWarpMarker(clipId: string, markerId: string, targetBeat: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId);
    if (!settings) {
        return;
    }
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, {
        ...settings,
        markers: settings.markers.map((m) => (m.id === markerId && !m.locked ? { ...m, targetBeat } : m)),
    });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
