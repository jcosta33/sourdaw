import { getTrackById as repoGetTrackById } from '#/modules/Track/repositories/trackRepository';
import { type Track } from '#/modules/Track/models/Track';

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return repoGetTrackById(trackId);
}
