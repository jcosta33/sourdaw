import { trackStore } from '../stores/trackStore';
import { type TrackStoreState } from '../stores/trackStore';

export function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}
