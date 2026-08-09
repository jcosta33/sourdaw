import { updateClip } from '../../repositories/track/updateClip';

export function setClipLoopLength(clipId: string, loopLength: number): boolean {
    if (!Number.isFinite(loopLength) || loopLength <= 0) {
        return false;
    }

    return updateClip(clipId, (context) => ({ ...context, loopLength }));
}
