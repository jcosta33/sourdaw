import { inject } from '#/infra/di/inject';
import { trackStore, type TrackStoreState } from '../stores/trackStore';

export type { TrackStoreState };

export const getTrackStoreState = inject({ trackStore })(({ trackStore: store }) => {
    return function getTrackStoreState(): TrackStoreState | null {
        return store.value;
    };
});
