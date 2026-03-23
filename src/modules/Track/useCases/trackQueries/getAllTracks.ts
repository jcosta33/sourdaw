import { getAllTracks as repoGetAllTracks } from '#/modules/Track/repositories/trackRepository';
import { type Track } from '#/modules/Track/models/Track';

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return repoGetAllTracks();
}
