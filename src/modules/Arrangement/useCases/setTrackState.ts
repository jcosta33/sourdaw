import { type TrackState } from '../repositories/track/getTrackState';
import { setTrackState as repoSetTrackState } from '../repositories/track/setTrackState';

export function setTrackState(state: TrackState): void {
    repoSetTrackState(state);
}
