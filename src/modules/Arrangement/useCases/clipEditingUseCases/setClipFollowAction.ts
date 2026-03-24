import { updateClip } from '#/modules/Arrangement/repositories/trackRepository';
import { type Clip } from '#/modules/Arrangement/models/Track';

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}
