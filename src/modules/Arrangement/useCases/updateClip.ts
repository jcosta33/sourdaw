import { updateClip as repoUpdateClip } from '../repositories/track/updateClip';
import { type Clip } from '../stores/trackStore';

export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    repoUpdateClip(clipId, updater);
}
