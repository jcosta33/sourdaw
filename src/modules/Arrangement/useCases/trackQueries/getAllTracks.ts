import { getAllTracks as repoGetAllTracks } from '#/modules/Arrangement/repositories/track';
import { type Track } from '#/modules/Arrangement/models/Track';

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return repoGetAllTracks();
}
