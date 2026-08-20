import { updateClip } from '../../repositories/track/updateClip';
import { clampClipGain } from '../../transformers/clampClipGain';

export function setClipGain(clipId: string, gain: number): boolean {
    return updateClip(clipId, (context) => ({ ...context, gain: clampClipGain(gain) }));
}
