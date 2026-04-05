import { getAllTracks as repoGetAllTracks } from '../repositories/track/getAllTracks';
import { type Track } from '../models/Track';

export function getAllTracks(): Track[] {
    return repoGetAllTracks();
}
