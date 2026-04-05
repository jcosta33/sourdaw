import { updateTrack as repoUpdateTrack } from '../repositories/track/updateTrack';
import { type Track } from '../models/Track';

export function updateTrack(trackId: string, updater: (track: Track) => Track): void {
    repoUpdateTrack(trackId, updater);
}
