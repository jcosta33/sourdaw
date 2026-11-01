import { activeRecordingRef } from '#/modules/Arrangement/stores';
import { stopRecording, takeOwnsRecordingRoot } from '#/modules/Arrangement/useCases';

import { captureRecordingEnd } from './captureRecordingEnd';
import { recordingLifecycle } from './recordingLifecycle';

/**
 * Finalize a recording the transport stopped on its own — a punch-out at the
 * region end, or a scheduler teardown — and hand its commit to the recording
 * lifecycle.
 *
 * `stopRecording` owns a MIDI commit, and the very next Undo acts on whatever
 * heads the history. Discarding its promise here would leave that commit with
 * no owner, so a user-facing stop would resolve while the entry was still in
 * flight (#4439). `trackTakeCommit` only registers the promise: the scheduler
 * call sites never await it, so the tick path stays unblocked.
 *
 * A stop that will refuse — the root moved mid-take, or the refs are already
 * cleared by an earlier stop of the same gesture — closes nothing and must
 * not read as a take this project gained (#5517), so it is not tracked at
 * all.
 */
export function finalizeAutomaticRecording(atBeat: number): void {
    const closesTake = activeRecordingRef.current.length > 0 && takeOwnsRecordingRoot();
    const ending = captureRecordingEnd();
    recordingLifecycle.endRecording();
    const finalized = stopRecording(atBeat, ending);
    if (closesTake) {
        recordingLifecycle.trackTakeCommit(finalized);
    }
}
