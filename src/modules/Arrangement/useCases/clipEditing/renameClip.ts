import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const renameClip = inject({ updateClip })(
    ({ updateClip }) =>
        function renameClip(clipId: string, name: string): void {
            updateClip(clipId, (c) => ({ ...c, name }));
        }
);
