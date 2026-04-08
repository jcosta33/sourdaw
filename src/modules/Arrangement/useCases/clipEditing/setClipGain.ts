import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const setClipGain = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipGain(clipId: string, gain: number): void {
            updateClip(clipId, (c) => ({ ...c, gain: Math.max(0, Math.min(2, gain)) }));
        }
);
