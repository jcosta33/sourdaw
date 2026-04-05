import { updateClip as repoUpdateClip } from '../repositories/track/updateClip';
import { type Clip } from '../models/Track';

export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    repoUpdateClip(clipId, updater);
}
