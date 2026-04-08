import { inject } from '#/infra/di/inject';
import { setTrackState as repoSetTrackState } from '../repositories/track/setTrackState';
import { type TrackState } from '../repositories/track/getTrackState';

export const setTrackState = inject({ repoSetTrackState })(
    ({ repoSetTrackState }) =>
        function setTrackState(state: TrackState): void {
            repoSetTrackState(state);
        }
);
