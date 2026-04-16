import { trackStore } from '../../stores/trackStore';

/**
 * Toggle the visibility of variation (alternative) lanes in the timeline for a track (H3).
 */
export function toggleVariationLanes(trackId: string, force?: boolean): void {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId
                ? { ...t, showVariationLanes: force !== undefined ? force : !t.showVariationLanes }
                : t
        ),
    });
}
