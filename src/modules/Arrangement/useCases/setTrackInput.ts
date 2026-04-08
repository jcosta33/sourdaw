import { inject } from '#/infra/di/inject';
import { updateTrack } from '../repositories/track/updateTrack';

export const setTrackInput = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setTrackInput(trackId: string, inputId: string | null): void {
            updateTrack(trackId, (t) => ({ ...t, inputId }));
        }
);
