import { updateClip } from '../../repositories/track/updateClip';

export function setClipLoopLength(clipId: string, loopLength: number): void {
    if (loopLength <= 0) {
        return;
    }
    updateClip(clipId, (c) => ({ ...c, loopLength }));
}
