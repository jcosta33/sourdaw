import {
    reconcileAutoInputMonitoring,
    startInputMonitoring,
    stopTrackInputMonitoring,
} from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type InputMonitoring } from '../../stores/trackStore';

/**
 * Canonical input-monitoring cycle order: auto → on → off → auto.
 *
 * Shared so the keybind use-case and the TrackHeader button advance the state
 * identically — previously the use-case toggled on↔off (skipping `auto`) while
 * the button cycled through all three, so the same logical action behaved
 * differently depending on entry point (finding #44).
 */
export const INPUT_MONITORING_CYCLE: Record<InputMonitoring, InputMonitoring> = {
    auto: 'on',
    on: 'off',
    off: 'auto',
};

export function toggleInputMonitoring(trackId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    if (!getTrackEligibility(track.kind).acceptsMonitoring) {
        return;
    }
    const newValue = INPUT_MONITORING_CYCLE[track.inputMonitoring];
    updateTrack(trackId, (time) => ({ ...time, inputMonitoring: newValue }));

    // 'on' starts hardware monitoring and 'off' stops it for this track only;
    // 'auto' belongs to the Auto owner, which opens or closes the edge from arm
    // and transport state. Other tracks' monitor edges are untouched.
    if (newValue === 'on') {
        void startInputMonitoring(trackId, track.inputId);
    } else if (newValue === 'off') {
        stopTrackInputMonitoring(trackId);
    } else {
        reconcileAutoInputMonitoring();
    }
}
