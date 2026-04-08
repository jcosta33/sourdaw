import { inject } from '#/infra/di/inject';
import { mapAllTracks } from '../repositories/track/mapAllTracks';

export const zoomTracksVertical = inject({ mapAllTracks })(
    ({ mapAllTracks }) =>
        function zoomTracksVertical(delta: number): void {
            mapAllTracks((t) => ({
                ...t,
                height: Math.max(30, Math.min(300, (t.height ?? 64) + delta)),
            }));
        }
);
