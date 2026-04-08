import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';

export const acceptGhostClip = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function acceptGhostClip(clipId: string): void {
            mapAllTracks((t) => ({
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? { ...c, isGhost: undefined } : c)),
            }));
        }
);
