import { trackStore } from '../stores/trackStore';
import { type Track } from '../models/Track';

type TrackStoreState = { tracks: Track[]; selectedTrackId: string | null };

export function getTrackStoreState(): TrackStoreState | null {
    return trackStore.value;
}
