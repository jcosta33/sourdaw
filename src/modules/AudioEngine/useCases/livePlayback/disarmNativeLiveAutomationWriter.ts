/**
 * End the live automation writer's current pass (#3068, D3.c.4b).
 *
 * The third verb of the writer's lifecycle, beside `armNativeLiveAutomationWriter`
 * and `pumpNativeLiveAutomationWriter`; `nativeLiveAutomationWriterState.ts`
 * holds the state the three share.
 */

import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';

/**
 * What the engine already holds is left to the engine: a stop applies
 * `hold_automation` and a locate applies `cancel_from`, both of which resolve
 * the queue without anything from this side. Bumping the epoch is what makes a
 * pump still out on the bridge answer into a pass that no longer exists.
 */
export function disarmNativeLiveAutomationWriter(): void {
    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.pass = null;
    // A re-read is owed by one pass, and this ends it. Left standing, the next
    // session's first reading would take it and re-arm against a fence from an
    // engine world that no longer exists.
    nativeLiveAutomationWriter.pendingRearm = null;
    // The next session's first arm gets to say what it excluded, whatever this
    // one already reported.
    nativeLiveAutomationWriter.reportedExclusions = null;
}
