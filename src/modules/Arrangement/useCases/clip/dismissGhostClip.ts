import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';

export const dismissGhostClip = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function dismissGhostClip(clipId: string): void {
            mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
        }
);
