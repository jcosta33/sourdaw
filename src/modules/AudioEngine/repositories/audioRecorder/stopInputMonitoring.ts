import { runAllEffects } from '#/utils/runEffects';

import {
    inputMonitoringAdmissionChecks,
    inputMonitoringSession,
    type MonitorCaptureKey,
} from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';

/**
 * Explicit global teardown: every listening edge, every keyed capture and all
 * pending interest. This is not the implementation of one track's mode change
 * — that is `stopTrackInputMonitoring`, which preserves other tracks' edges.
 *
 * Pending acquisitions are orphaned rather than cancelled: each settlement
 * releases its late stream exactly once and can never connect a fresh edge,
 * because a start after teardown acquires its own request for that key. The
 * teardown epoch advances so an open that was in flight reads its settlement as
 * cancelled rather than refused.
 */
export function stopInputMonitoring(): void {
    inputMonitoringSession.teardownEpoch++;
    const keys: MonitorCaptureKey[] = [...inputMonitoringSession.captures.keys()];
    const effects: Array<() => void> = [];
    for (const key of keys) {
        const capture = inputMonitoringSession.captures.get(key);
        if (capture) {
            for (const destination of capture.monitorEdges.values()) {
                effects.push(() => capture.monitorSource.disconnect(destination));
            }
            capture.monitorEdges.clear();
        }
        effects.push(() => releaseMonitorCapture(key));
    }
    inputMonitoringSession.trackKeys.clear();
    inputMonitoringAdmissionChecks.clear();
    inputMonitoringSession.pendingRequests.clear();
    runAllEffects(effects);
}
