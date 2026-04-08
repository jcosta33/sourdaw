import { inject } from '#/infra/di/inject';
import { updateTrackState } from '#/modules/Arrangement/repositories/track/updateTrackState';
import { getTrackById } from '#/modules/Arrangement/repositories/track/getTrackById';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';

export const selectTrack = inject({ updateTrackState, getTrackById })(
    ({ updateTrackState, getTrackById }) =>
        function selectTrack(trackId: string | null): void {
            updateTrackState({ selectedTrackId: trackId });

            if (trackId) {
                const track = getTrackById(trackId);
                if (track && track.kind === 'midi') {
                    setMidiInputTrack(trackId);
                }
            }
        }
);
