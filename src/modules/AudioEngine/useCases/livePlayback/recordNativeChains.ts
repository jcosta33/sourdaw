/**
 * Fold the strip reports of a batch into the session's record of what the
 * engine's chains hold (#3575).
 *
 * The input is reports rather than the commands the batch carried, because a
 * report is the engine's own observation of a realized chain and the only thing
 * that can say what an index addresses. A device the mapper degraded was asked
 * for and is not there, so a record built from requests would place every later
 * insert one slot wrong.
 *
 * A chain edit or an automation batch touches only the strips it names, so its
 * reports merge; a topology batch replaces the record instead.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function recordNativeChains(reports: readonly AudioGraphStripReport[]): void {
    if (reports.length === 0) {
        return;
    }
    const next = new Map(nativeLiveGraphSession.nativeChainByStripId);
    for (const report of reports) {
        next.set(report.id, report.deviceIds);
    }
    nativeLiveGraphSession.nativeChainByStripId = next;
}
