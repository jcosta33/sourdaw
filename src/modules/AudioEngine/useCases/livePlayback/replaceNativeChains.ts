/**
 * Take the strip reports of a topology batch as the whole record of what the
 * engine's chains hold (#3575).
 *
 * A topology batch tears every strip down inside its own fence and builds the
 * graph again, so a strip absent from its reports is a strip the engine no
 * longer has. Merging those reports would leave the record naming strips
 * nothing can address.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function replaceNativeChains(reports: readonly AudioGraphStripReport[]): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map(reports.map((report) => [report.id, report.deviceIds]));
}
