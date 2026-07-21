import { updateClip as repoUpdateClip } from '../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../stores/trackStore';

export function updateClip(clipId: string, updater: (clip: Clip) => Clip): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible') {
        return false;
    }
    return repoUpdateClip(clipId, updater);
}
