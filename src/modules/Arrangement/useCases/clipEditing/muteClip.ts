import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const muteClip = inject({ updateClip })(
    ({ updateClip }) =>
        function muteClip(clipId: string, muted: boolean): void {
            updateClip(clipId, (c) => ({ ...c, muted }));
        }
);
