import { inject } from '#/infra/di/inject';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

export const setClipFade = inject({ updateClip })(
    ({ updateClip }) =>
        function setClipFade(clipId: string, fadeInBeats: number, fadeOutBeats: number): void {
            updateClip(clipId, (c) => ({
                ...c,
                fadeInBeats: Math.max(0, fadeInBeats),
                fadeOutBeats: Math.max(0, fadeOutBeats),
            }));
        }
);
