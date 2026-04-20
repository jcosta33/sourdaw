import { trackStore } from '../../stores/trackStore';

import { type TrackState } from './getTrackState';

/** Partial update of the track state (merges with current). */
export function updateTrackState(patch: Partial<TrackState>): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({ ...state, ...patch });
}
