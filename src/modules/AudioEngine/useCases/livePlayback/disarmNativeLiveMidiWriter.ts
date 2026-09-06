/**
 * End the live MIDI pass (#3892).
 *
 * The epoch is bumped rather than merely cleared, so a batch still in flight
 * settles into a pass that no longer exists and cannot advance a cursor into
 * it. Nothing is sent: the engine releases its sounding notes on stop and on
 * locate by itself (`release_sounding_notes`), and a clear from this side would
 * race the very batch the next arm is about to send.
 *
 * The note-edit subscriptions go with the pass. They exist to keep a rolling
 * store true to the project; with nothing rolling there is nothing to keep
 * true, and the next arm re-reads the project whole.
 */

import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';

export function disarmNativeLiveMidiWriter(): void {
    nativeLiveMidiWriter.epoch += 1;
    nativeLiveMidiWriter.pass = null;
    nativeLiveMidiWriter.pendingRearm = false;
    // The next pass says its own exclusions: a set reported against a session
    // that ended is not evidence about the one that starts next.
    nativeLiveMidiWriter.reportedExclusions = null;
    nativeLiveMidiWriter.unwatch?.();
    nativeLiveMidiWriter.unwatch = null;
}
