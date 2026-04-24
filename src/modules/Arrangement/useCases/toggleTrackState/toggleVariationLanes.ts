import { trackStore } from '../../stores/trackStore';

/**
 * Toggle the visibility of variation (alternative) lanes in the timeline for a track (H3).
 */
export function toggleVariationLanes(trackId: string, force?: boolean): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((time) =>
            time.id === trackId
                ? { ...time, showVariationLanes: force !== undefined ? force : !time.showVariationLanes }
                : time
        ),
    });
}
