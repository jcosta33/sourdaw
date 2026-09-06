/**
 * Re-read the current pass's notes without moving the transport (#3892).
 *
 * A pass is a projection taken once, over the strips, clips and notes the
 * session held then. A note drawn under a rolling playhead, a clip spliced into
 * the graph, a loop region appearing or going away, an instrument arriving in a
 * chain — each changes what that projection would say while the playhead keeps
 * walking, and each re-reads the same way: from where the engine stands.
 *
 * The caller supplies that position, and the pass's own entry stands in when it
 * has none. The opening batch of the new pass clears every target's store
 * whole, so a position slightly behind the engine's true one costs a re-send of
 * notes it already held rather than a gap; one far ahead would skip the bar the
 * musician is listening to, which is why the live reading is preferred to the
 * entry whenever a caller holds one.
 *
 * The attach state is read here rather than carried on the pass, because an
 * instrument arriving in or leaving a chain is one of the things that re-arms:
 * a pass re-read against the set it opened with would keep addressing an
 * instrument the engine no longer holds. One read, handed on, so the
 * programme's projection and the writer's targets answer to the same set.
 */

import { armNativeLiveMidiWriter } from './armNativeLiveMidiWriter';
import { currentStripTracks } from './currentStripTracks';
import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';
import { readAttachedExternalInstanceIds } from './readAttachedExternalInstanceIds';

export type RearmNativeLiveMidiWriterInPlaceInput = Readonly<{
    /**
     * Where the engine stands, when the caller holds a reading of it. Omitted,
     * the pass re-opens at its own entry.
     */
    positionSeconds?: number;
}>;

export async function rearmNativeLiveMidiWriterInPlace(input: RearmNativeLiveMidiWriterInPlaceInput): Promise<void> {
    const pass = nativeLiveMidiWriter.pass;
    if (!pass) {
        return;
    }
    await armNativeLiveMidiWriter({
        stripTracks: currentStripTracks(pass.stripTracks),
        attachedInstanceIds: readAttachedExternalInstanceIds(),
        sampleRate: pass.sampleRate,
        positionSeconds: input.positionSeconds ?? pass.entrySeconds,
    });
}
