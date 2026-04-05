import { trackStore } from '../../stores/trackStore';
import { type Track } from '../../models/Track';

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return trackStore.value?.tracks.find((t) => t.id === trackId);
}
