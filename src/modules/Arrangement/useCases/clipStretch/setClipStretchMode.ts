import { updateClip } from '../../repositories/track/updateClip';
import { type StretchMode } from '../../models/Track';

export function setClipStretchMode(clipId: string, mode: StretchMode): void {
    updateClip(clipId, (c) => ({ ...c, stretchMode: mode }));
}