import { recordTrackSelectionIntent, trackStore } from '../../stores/trackStore';

import { type TrackState } from './getTrackState';

/** Partial update of the track state (merges with current). */
export function updateTrackState(patch: Partial<TrackState>): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const next = { ...state, ...patch };
    if (Object.hasOwn(patch, 'selectedTrackId') && !Object.hasOwn(patch, 'tracks')) {
        recordTrackSelectionIntent(next);
    }
    trackStore.set(next);
}
