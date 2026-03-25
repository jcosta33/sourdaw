import { updateClip } from '#/modules/Arrangement/repositories/track';

export function setClipColor(clipId: string, color: string): void {
    updateClip(clipId, (c) => ({ ...c, color }));
}
