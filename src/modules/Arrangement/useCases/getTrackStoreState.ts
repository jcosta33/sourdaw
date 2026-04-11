import { trackStore, type TrackStoreState } from '../stores/trackStore';

export type { TrackStoreState };

export function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}
