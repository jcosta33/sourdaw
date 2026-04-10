import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { type Clip } from '#/modules/Arrangement/stores/trackStore';

export const setClipFollowAction = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
            updateClip(clipId, (c) => ({ ...c, followAction }));
        }
);
