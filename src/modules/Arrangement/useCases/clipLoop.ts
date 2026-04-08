import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const setClipLoop = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipLoop(clipId: string, enabled: boolean): void {
            updateClip(clipId, (c) => ({ ...c, loopEnabled: enabled }));
        }
);

export const setClipLoopLength = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipLoopLength(clipId: string, loopLength: number): void {
            if (loopLength <= 0) {
                return;
            }
            updateClip(clipId, (c) => ({ ...c, loopLength }));
        }
);
