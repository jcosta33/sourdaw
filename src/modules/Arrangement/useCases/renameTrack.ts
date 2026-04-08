import { inject } from '#/infra/di/inject';
import { updateTrack } from '../repositories/track/updateTrack';

export const renameTrack = inject({ updateTrack })(
    ({ updateTrack }) =>
        function renameTrack(trackId: string, name: string): void {
            updateTrack(trackId, (t) => ({ ...t, name }));
        }
);
