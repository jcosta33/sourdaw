/**
 * State that the pass owes a re-read, for a caller that must not take one
 * itself (#3568).
 *
 * The splice that answers an attach report is reached from the automation
 * pump's own batch result, so a splice that armed the writer would put the arm
 * downstream of the pump the arm starts. Recording the need instead leaves the
 * writer's own modules in one direction, and the playhead feed takes it on its
 * next reading — see `nativeLiveAutomationWriter.pendingRearm`.
 *
 * Last request wins: a re-read is a whole re-projection, not an increment, so
 * two of them before one reading are one re-read. The later fence is the one
 * kept, because it is the batch the new pass must not be believed ahead of.
 */

import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';

export type RequestNativeLiveAutomationWriterRearmInput = Readonly<{
    /** The engine fence number of the batch that made the re-read necessary. */
    provenAfterBatch: number | null;
}>;

export function requestNativeLiveAutomationWriterRearm(input: RequestNativeLiveAutomationWriterRearmInput): void {
    if (!nativeLiveAutomationWriter.pass) {
        // No pass to re-read. The next arm reads the world as it is by then,
        // which already includes whatever this request was about.
        return;
    }
    nativeLiveAutomationWriter.pendingRearm = { provenAfterBatch: input.provenAfterBatch };
}
