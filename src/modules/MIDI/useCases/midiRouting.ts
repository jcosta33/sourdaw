/**
 * Multi-Channel MIDI Routing use cases.
 * Allows routing MIDI output from one track to the input of another.
 *
 * All store access goes through the Track repository.
 */

import { inject } from '#/infra/di/inject';
import { updateTrack as updateTrackDependency } from '#/modules/Arrangement/useCases';

export const setMidiOutput = inject({ updateTrackDependency: () => updateTrackDependency })(
    ({ updateTrackDependency }) =>
        function setMidiOutput(trackId: string, destinationTrackId: string): void {
            const updateTrack = updateTrackDependency();
            updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: destinationTrackId }));
        }
);

export const clearMidiOutput = inject({ updateTrackDependency: () => updateTrackDependency })(
    ({ updateTrackDependency }) =>
        function clearMidiOutput(trackId: string): void {
            const updateTrack = updateTrackDependency();
            updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: null }));
        }
);
