import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const trimClipEnd = inject({ updateClip })(
    ({ updateClip }) =>
        function trimClipEnd(clipId: string, newEndBeat: number): void {
            updateClip(clipId, (c) => (newEndBeat > c.startBeat ? { ...c, endBeat: newEndBeat } : c));
        }
);
