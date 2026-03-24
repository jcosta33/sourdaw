import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';

export function setClipColor(clipId: string, color: string): void {
    updateClip(clipId, (c) => ({ ...c, color }));
}
