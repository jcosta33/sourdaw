import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type InputMonitoring } from '../../stores/trackStore';

export function setInputMonitoring(trackId: string, mode: InputMonitoring): void {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsMonitoring) {
        if (mode === 'off') {
            updateTrack(trackId, (time) => ({ ...time, inputMonitoring: 'off' }));
        }
        return;
    }
    updateTrack(trackId, (time) => ({ ...time, inputMonitoring: mode }));

    if (mode === 'on') {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
