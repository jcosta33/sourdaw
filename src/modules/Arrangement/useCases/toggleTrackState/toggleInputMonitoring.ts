import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
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
    const newValue = INPUT_MONITORING_CYCLE[track.inputMonitoring];
    updateTrack(trackId, (time) => ({ ...time, inputMonitoring: newValue }));

    // 'on' starts hardware monitoring; 'off' and 'auto' both stop it (auto is
    // engine-driven by arm/record state, not a live always-on monitor here).
    if (newValue === 'on') {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
