import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const hideTrack = inject({ updateTrack })(
    ({ updateTrack }) =>
        function hideTrack(trackId: string, hidden: boolean): void {
            updateTrack(trackId, (t) => ({ ...t, hidden }));
        }
);
