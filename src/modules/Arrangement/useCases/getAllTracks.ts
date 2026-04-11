import { getAllTracks as repoGetAllTracks } from '../repositories/track/getAllTracks';
import { type Track } from '../stores/trackStore';

export function getAllTracks(): Track[] {
    return repoGetAllTracks();
}
