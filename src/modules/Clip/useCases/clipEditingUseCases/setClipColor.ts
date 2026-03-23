import { updateClip } from '#/modules/Track/repositories/trackRepository';

export function setClipColor(clipId: string, color: string): void {
    updateClip(clipId, (c) => ({ ...c, color }));
}
