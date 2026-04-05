import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { type Clip } from '#/modules/Arrangement/models/Track';

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}
