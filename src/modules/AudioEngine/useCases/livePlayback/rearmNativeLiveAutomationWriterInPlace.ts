/**
 * Re-read the current pass's automation without moving the transport (#3068,
 * #3568).
 *
 * A pass is a projection taken once, at arm, over the strips and devices the
 * session held then. Some things change what that projection would say without
 * moving the playhead at all — the loop region going away under it, or a plugin
 * arriving in a chain whose parameters the engine can now be stamped for. Each
 * of those has to re-read, and each of them re-reads the same way: from where
 * the engine actually stands.
 *
 * The caller supplies that position, and the pass's own entry stands in when it
 * has none. A position behind the playhead only re-sends writes the engine
 * resolves to their end state; one ahead of it would skip the stretch of curve
 * the musician is listening to.
 *
 * Never a seek. Nothing here located the transport, so the engine's ledger ran
 * no `apply_seek` and the mirror must keep every stamp it believes is queued —
 * pruning one would free a slot the engine still charges.
 */

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';

export type RearmNativeLiveAutomationWriterInPlaceInput = Readonly<{
    /**
     * The engine fence number of the batch that caused this re-read, or `null`
     * when it reported none: the world this pass is written into is not the
     * engine's until that batch has drained.
     */
    provenAfterBatch: number | null;
    /**
     * Where the engine stands, when the caller holds a reading of it. Omitted,
     * the pass re-opens at its own entry.
     */
    positionSeconds?: number;
}>;

export function rearmNativeLiveAutomationWriterInPlace(input: RearmNativeLiveAutomationWriterInPlaceInput): void {
    const pass = nativeLiveAutomationWriter.pass;
    if (!pass) {
        return;
    }
    // Whatever this re-read was asked for, it re-reads the whole projection —
    // so a request recorded for the same pass is answered by it and must not
    // make the next feed reading re-arm a second time.
    nativeLiveAutomationWriter.pendingRearm = null;
    armNativeLiveAutomationWriter({
        stripTracks: pass.stripTracks,
        sampleRate: pass.sampleRate,
        programmeEndSeconds: pass.programmeEndSeconds,
        positionSeconds: input.positionSeconds ?? pass.entrySeconds,
        provenAfterBatch: input.provenAfterBatch,
    });
}
