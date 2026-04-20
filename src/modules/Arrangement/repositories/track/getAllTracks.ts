import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}
