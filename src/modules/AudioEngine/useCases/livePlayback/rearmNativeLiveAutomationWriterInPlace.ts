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

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';

/**
 * The pass's own strips, with each one's contents as project truth holds them
 * now.
 *
 * Re-reading the contents is the whole of what a chain re-arm is for: the
 * plugin that triggered it arrived in `trackStore` after the pass was taken, so
 * projecting the arm-time objects again would find no parameters to carry while
 * the tick path — which reads the engine's own chain — has already stopped
 * writing that device over IPC.
 *
 * The strip *set* stays exactly the one the session's topology built. A strip
 * missing from the store keeps its arm-time object rather than dropping out:
 * `carriedStripIds` still names it, so its devices are still the engine's as
 * far as every other reader is concerned, and a strip dropped here would be
 * driven by neither engine.
 */
function currentStripTracks(stripTracks: readonly Track[]): readonly Track[] {
    const byId = new Map((trackStore.value?.tracks ?? []).map((track): [string, Track] => [track.id, track]));
    return stripTracks.map((track) => byId.get(track.id) ?? track);
}

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
    armNativeLiveAutomationWriter({
        stripTracks: currentStripTracks(pass.stripTracks),
        sampleRate: pass.sampleRate,
        programmeEndSeconds: pass.programmeEndSeconds,
        positionSeconds: input.positionSeconds ?? pass.entrySeconds,
        provenAfterBatch: input.provenAfterBatch,
    });
}
