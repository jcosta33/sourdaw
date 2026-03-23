import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';

export function getTakeLaneForTrack(trackId: string) {
    const state = takeLaneStore.value;
    if (!state) {
        return null;
    }
    return state.lanes.find((l) => l.trackId === trackId) ?? null;
}
