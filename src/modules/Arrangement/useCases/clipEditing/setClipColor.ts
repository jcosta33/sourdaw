import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const setClipColor = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipColor(clipId: string, color: string): void {
            updateClip(clipId, (c) => ({ ...c, color }));
        }
);
