import { getTrackById as repoGetTrackById } from '../repositories/track/getTrackById';
import { type Track } from '../models/Track';

export function getTrackById(trackId: string): Track | undefined {
    return repoGetTrackById(trackId);
}
