import { stopRecording } from '#/modules/Arrangement/useCases';

import { recordingLifecycle } from './recordingLifecycle';

/**
 * Finalize a recording the transport stopped on its own — a punch-out at the
 * region end, or a scheduler teardown — and hand its commit to the recording
 * lifecycle.
 *
 * `stopRecording` owns a MIDI commit, and the very next Undo acts on whatever
 * heads the history. Discarding its promise here would leave that commit with
 * no owner, so a user-facing stop would resolve while the entry was still in
 * flight (#4439). `trackCommit` only registers the promise: the scheduler call
 * sites never await it, so the tick path stays unblocked.
 */
export function finalizeAutomaticRecording(atBeat: number): void {
    recordingLifecycle.trackCommit(stopRecording(atBeat));
}
