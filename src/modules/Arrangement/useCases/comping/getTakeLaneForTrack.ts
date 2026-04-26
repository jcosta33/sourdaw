import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

export function getTakeLaneForTrack(trackId: string): TakeLane | null {
    const state = takeLaneStore.value;
    if (!state) {
        return null;
    }
    return state.lanes.find((length) => length.trackId === trackId) ?? null;
}
