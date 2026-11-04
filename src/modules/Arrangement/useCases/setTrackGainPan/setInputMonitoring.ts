import { reconcileAutoInputMonitoring, startInputMonitoring } from '#/modules/AudioEngine/useCases';

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

    // The monitor owner follows committed intent during an optimistic Off, so
    // a refused project write cannot discard an already admitted listening edge.
    if (mode === 'on') {
        void startInputMonitoring(trackId, track?.inputId);
    } else {
        reconcileAutoInputMonitoring();
    }
}
