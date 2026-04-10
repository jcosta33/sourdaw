import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { getTrackById } from '#/modules/Arrangement/repositories/track/getTrackById';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine';

export const toggleInputMonitoring = inject({ updateTrack, getTrackById })(
    ({ updateTrack, getTrackById }) =>
        function toggleInputMonitoring(trackId: string): void {
            const track = getTrackById(trackId);
            if (!track) {
                return;
            }
            const newValue = track.inputMonitoring === 'on' ? 'off' : 'on';
            updateTrack(trackId, (t) => ({ ...t, inputMonitoring: newValue }));

            if (newValue === 'on') {
                startInputMonitoring(trackId);
            } else {
                stopInputMonitoring();
            }
        }
);
