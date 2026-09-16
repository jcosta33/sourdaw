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
 * is where a session start and a rebind land — every batch that replaces the
 * whole topology — so it is where the foot the renderer remembered
 * (`liveMidiControlLatch.ts`) is spent: one controller per remembered pedal
 * whose device the new chain holds. A mid-roll chain rebuild never comes
 * through here: it edits one strip rather than replacing the topology, and it
 * carries the same remembered pedals inside its own batch
 * (`mirrorDeviceChainDelta.ts`).
 * `sendNativeLiveMidiControl` latches synchronously and defers the actual send
 * — and its read of the chain record — onto the session queue, so by the time
 * that read runs, this function's synchronous record write above has already
 * happened regardless of statement order. Without this replay a damper pressed
 * before play would be a pedal the engine never heard.
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
