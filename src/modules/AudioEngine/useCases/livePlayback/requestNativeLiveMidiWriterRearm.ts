/**
 * Record that the live MIDI pass owes a re-read, without taking it (#3892).
 *
 * The callers are edits, not ticks: a note drawn under a rolling playhead, a
 * clip spliced into the graph. Re-projecting on each of them would put a whole
 * projection on every keystroke, and none of them knows where the engine
 * actually is. The playhead feed takes the request on its next reading, which
 * both coalesces a burst into one re-arm and supplies a live position.
 */

import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';

export function requestNativeLiveMidiWriterRearm(): void {
    // No pass, nothing to re-read: a request recorded now would be taken by the
    // next pass, which reads the edited project when it opens anyway.
    if (!nativeLiveMidiWriter.pass) {
        return;
    }
    nativeLiveMidiWriter.pendingRearm = true;
}
