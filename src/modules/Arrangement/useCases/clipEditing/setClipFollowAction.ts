import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { type Clip } from '#/modules/Arrangement/models/Track';

export const setClipFollowAction = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
            updateClip(clipId, (c) => ({ ...c, followAction }));
        }
);
