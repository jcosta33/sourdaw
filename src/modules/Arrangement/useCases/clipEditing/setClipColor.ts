import { updateClip } from '../../repositories/track/updateClip';

export function setClipColor(clipId: string, color: string): boolean {
    return updateClip(clipId, (context) => ({ ...context, color }));
}
