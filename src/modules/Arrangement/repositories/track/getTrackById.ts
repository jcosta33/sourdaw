import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return trackStore.value?.tracks.find((time) => time.id === trackId);
}
