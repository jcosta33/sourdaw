import { trackStore } from '../../stores/trackStore';
import { type Track } from '../../models/Track';

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}
