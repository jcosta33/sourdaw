import { updateClip } from '../../repositories/track/updateClip';

export function setClipColor(clipId: string, color: string): void {
    updateClip(clipId, (c) => ({ ...c, color }));
}
