/**
 * Multi-Channel MIDI Routing use cases.
 * Allows routing MIDI output from one track to the input of another.
 *
 * All store access goes through the Track repository.
 */

import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/useCases/updateTrack';

export const setMidiOutput = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setMidiOutput(trackId: string, destinationTrackId: string): void {
            updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: destinationTrackId }));
        }
);

export const clearMidiOutput = inject({ updateTrack })(
    ({ updateTrack }) =>
        function clearMidiOutput(trackId: string): void {
            updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: null }));
        }
);
