import {
    audioWarpStore,
    DEFAULT_WARP_SETTINGS,
    getNextWarpMarkerId,
    type WarpMarker,
} from '../../stores/audioWarp';

export function addWarpMarker(clipId: string, sourceSec: number, targetBeat: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS };
    const marker: WarpMarker = {
        id: getNextWarpMarkerId(),
        sourceSec,
        targetBeat,
        locked: false,
    };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, {
        ...settings,
        markers: [...settings.markers, marker].sort((a, b) => a.sourceSec - b.sourceSec),
    });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
