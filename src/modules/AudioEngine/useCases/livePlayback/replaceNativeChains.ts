/**
 * Take the strip reports of a topology batch as the whole record of what the
 * engine's chains hold, and press the player's pedals back onto the bodies it
 * just built (#3575, #3998).
 *
 * A topology batch tears every strip down inside its own fence and builds the
 * graph again, so a strip absent from its reports is a strip the engine no
 * longer has. Merging those reports would leave the record naming strips
 * nothing can address.
 *
 * Every body in those chains is therefore brand new, with its pedals up. This
 * is where a session start, a rebind and a chain rebuild all land, so it is
 * where the foot the renderer remembered (`liveMidiControlLatch.ts`) is spent:
 * one controller per remembered pedal whose device the new chain holds, sent
 * after the record is written because the send reads that record to decide who
 * still has a body. Without it a damper pressed before play, or held across a
 * chain reorder, would be a pedal the engine never heard.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';
import { readLatchedLiveMidiControls } from '../../services/liveMidiControlLatch';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { sendNativeLiveMidiControl } from './sendNativeLiveMidiControl';

export function replaceNativeChains(reports: readonly AudioGraphStripReport[]): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map(reports.map((report) => [report.id, report.deviceIds]));
    for (const control of readLatchedLiveMidiControls()) {
        void sendNativeLiveMidiControl(control);
    }
}
