import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const lockClip = inject({ updateClip })(
    ({ updateClip }) =>
        function lockClip(clipId: string, locked: boolean): void {
            updateClip(clipId, (c) => ({ ...c, locked }));
        }
);
