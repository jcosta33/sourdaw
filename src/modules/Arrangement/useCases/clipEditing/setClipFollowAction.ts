import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { type Clip } from '#/modules/Arrangement/stores/trackStore';

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}
