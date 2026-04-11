import { setTrackState as repoSetTrackState } from '../repositories/track/setTrackState';
import { type TrackState } from '../repositories/track/getTrackState';

export function setTrackState(state: TrackState): void {
    repoSetTrackState(state);
}
