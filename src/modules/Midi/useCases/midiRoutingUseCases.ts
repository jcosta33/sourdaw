/**
 * Multi-Channel MIDI Routing use cases.
 * Allows routing MIDI output from one track to the input of another.
 *
 * All store access goes through the Track repository.
 */

import { updateTrack } from '#/modules/Track/repositories/trackRepository';

/**
 * Set the MIDI output of a source track to route to a destination track.
 */
export function setMidiOutput(trackId: string, destinationTrackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: destinationTrackId }));
}

/**
 * Clear the MIDI output routing for a track.
 */
export function clearMidiOutput(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, midiOutputTrackId: null }));
}
