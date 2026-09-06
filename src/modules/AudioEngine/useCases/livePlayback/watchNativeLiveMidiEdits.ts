/**
 * Notice that a rolling pass's notes are no longer the project's notes (#3892).
 *
 * The engine's note store is a copy, taken once when the pass opened. Every
 * later edit — a note drawn, dragged, deleted, a clip moved, muted or trimmed,
 * an undo, a remote change arriving through the CRDT — leaves that copy saying
 * something the project stopped saying, and the musician hears the old take
 * until the transport is stopped.
 *
 * Two stores rather than one: `midiStore` holds the notes inside a clip and
 * `trackStore` holds where the clips are, and an edit to either changes what
 * this producer would project.
 *
 * Nothing is re-projected here. A subscriber fires at the rate a musician
 * drags, and it also knows no engine position; the request is recorded and the
 * playhead feed takes it on its next reading, which coalesces the burst and
 * carries a position fresher than any of them.
 */

import { trackStore } from '#/modules/Arrangement/stores';
import { midiStore } from '#/modules/MIDI/stores';

import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';
import { requestNativeLiveMidiWriterRearm } from './requestNativeLiveMidiWriterRearm';

/**
 * Start watching for the life of the pass, at most once.
 *
 * Idempotent because every arm calls it and a pass re-arms freely: a second
 * subscription would answer one edit twice and, worse, outlive the disarm that
 * only ever drops one unsubscribe.
 */
export function watchNativeLiveMidiEdits(): void {
    if (nativeLiveMidiWriter.unwatch) {
        return;
    }
    const unsubscribes = [
        midiStore.subscribe(requestNativeLiveMidiWriterRearm),
        trackStore.subscribe(requestNativeLiveMidiWriterRearm),
    ];
    nativeLiveMidiWriter.unwatch = () => {
        for (const unsubscribe of unsubscribes) {
            unsubscribe();
        }
    };
}
