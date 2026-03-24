import { getTrackById as repoGetTrackById } from '#/modules/Arrangement/repositories/trackRepository';
import { type Track } from '#/modules/Arrangement/models/Track';

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return repoGetTrackById(trackId);
}
