import { trackStore } from '../../stores/trackStore';

import { type TrackState } from './getTrackState';

/** Replace the full track state. */
export function setTrackState(state: TrackState): void {
    trackStore.set(state);
}
