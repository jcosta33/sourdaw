import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const setTrackHeight = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setTrackHeight(trackId: string, height: number): void {
            updateTrack(trackId, (t) => ({ ...t, height: Math.max(30, Math.min(300, height)) }));
        }
);
