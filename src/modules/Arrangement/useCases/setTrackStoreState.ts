import { trackStore, type TrackStoreState } from '../stores/trackStore';

export function setTrackStoreState(state: TrackStoreState): void {
    trackStore.set(state);
}
