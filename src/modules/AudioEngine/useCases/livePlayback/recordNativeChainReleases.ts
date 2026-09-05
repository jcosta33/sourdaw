/**
 * Narrow the session's record of what the engine's chains hold onto the
 * strips an unload's own release touched (#3793).
 *
 * An unload changes native strip state with no batch of its own for
 * `recordNativeChains` to read, so its released strips arrive here instead,
 * through the sink `registerReleasedStripReportSink` wires up in
 * `src/app/bootstrap.ts`. Unlike `recordNativeChains`, which may add a strip
 * the session never built, this only ever narrows one it already holds: an
 * unload never creates a strip, and a report naming one this session did not
 * build has nothing here to narrow.
 */

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';

export function recordNativeChainReleases(reports: readonly AudioGraphStripReport[]): void {
    const held = reports.filter((report) => nativeLiveGraphSession.nativeChainByStripId.has(report.id));
    if (held.length === 0) {
        return;
    }
    const next = new Map(nativeLiveGraphSession.nativeChainByStripId);
    for (const report of held) {
        next.set(report.id, report.deviceIds);
    }
    nativeLiveGraphSession.nativeChainByStripId = next;
}
