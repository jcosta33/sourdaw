import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';

export const removeClip = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function removeClip(clipId: string): void {
            mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
        }
);
