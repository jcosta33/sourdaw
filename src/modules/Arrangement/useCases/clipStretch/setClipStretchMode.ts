import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { type StretchMode } from '#/modules/Arrangement/models/Track';

export function setClipStretchMode(clipId: string, mode: StretchMode): void {
    updateClip(clipId, (c) => ({ ...c, stretchMode: mode }));
}