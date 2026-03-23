import { updateClip } from '#/modules/Track/repositories/trackRepository';
import { type Clip } from '#/modules/Track/models/Track';

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}
