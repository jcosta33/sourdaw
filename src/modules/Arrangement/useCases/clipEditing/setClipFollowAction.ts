import { updateClip } from '../../repositories/track/updateClip';
import { type Clip } from '../../stores/trackStore';

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}
