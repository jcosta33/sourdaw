/**
 * Multi-Channel MIDI Routing use cases.
 * Allows routing MIDI output from one track to the input of another.
 *
 * All store access goes through the Track repository.
 */

import { updateTrack } from '#/modules/Arrangement/useCases';

export function setMidiOutput(trackId: string, destinationTrackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: destinationTrackId }));
}

export function clearMidiOutput(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: null }));
}
