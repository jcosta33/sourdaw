import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function setClipGain(clipId: string, gain: number): void {
    updateClip(clipId, (c) => ({ ...c, gain: Math.max(0, Math.min(2, gain)) }));
}
