import { inject } from '#/infra/di/inject';
import { trackStore, type TrackStoreState } from '../stores/trackStore';

export const setTrackStoreState = inject({ trackStore })(
    ({ trackStore: tracks }) =>
        function setTrackStoreState(state: TrackStoreState): void {
            tracks.set(state);
        }
);
