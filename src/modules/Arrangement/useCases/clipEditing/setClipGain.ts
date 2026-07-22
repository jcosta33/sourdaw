import { updateClip } from '../../repositories/track/updateClip';

export function setClipGain(clipId: string, gain: number): boolean {
    return updateClip(clipId, (context) => ({ ...context, gain: Math.max(0, Math.min(2, gain)) }));
}
