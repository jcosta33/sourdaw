import { type StretchMode } from '../../models/Track';
import { updateClip } from '../../repositories/track/updateClip';

export function setClipStretchMode(clipId: string, mode: StretchMode): void {
    updateClip(clipId, (context) => ({ ...context, stretchMode: mode }));
}
