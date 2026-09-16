/**
 * Take the strip reports of a topology batch as the whole record of what the
 * engine's chains hold (#3575).
 *
 * A topology batch tears every strip down inside its own fence and builds the
 * graph again, so a strip absent from its reports is a strip the engine no
 * longer has. Merging those reports would leave the record naming strips
 * nothing can address.
 *
 * The pedals those brand-new bodies come up without are not spent here. They
 * ride the topology batch itself, behind the commands that build the bodies
 * they address (`latchedPedalCommands.ts`): a pedal sent after the batch waits
 * on the session queue behind the task that installed the session, so the
 * engine renders at least one bridge round trip with the foot lifted — long
 * enough to strike a clip note with the hammers at full travel under a held una
 * corda, and to miss a sostenuto edge entirely.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function replaceNativeChains(reports: readonly AudioGraphStripReport[]): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map(reports.map((report) => [report.id, report.deviceIds]));
}
