import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine';

export const setTrackOutput = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setTrackOutput(trackId: string, outputId: string): void {
            updateTrack(trackId, (t) => ({ ...t, outputId }));
            engineSetTrackOutput(trackId, outputId);
        }
);
