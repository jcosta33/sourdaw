import { inputMonitoringSession, type MonitorCaptureKey } from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';

/**
 * Explicit global teardown: every listening edge, every keyed capture and all
 * pending interest. This is not the implementation of one track's mode change
 * — that is `stopTrackInputMonitoring`, which preserves other tracks' edges.
 *
 * Pending acquisitions are orphaned rather than cancelled: each settlement
 * releases its late stream exactly once and can never connect a fresh edge,
 * because a start after teardown acquires its own request for that key.
 */
export function stopInputMonitoring(): void {
    const keys: MonitorCaptureKey[] = [...inputMonitoringSession.captures.keys()];
    for (const key of keys) {
        const capture = inputMonitoringSession.captures.get(key);
        if (capture) {
            for (const destination of capture.monitorEdges.values()) {
                capture.monitorSource.disconnect(destination);
            }
        }
        releaseMonitorCapture(key);
    }
    inputMonitoringSession.trackKeys.clear();
    inputMonitoringSession.pendingRequests.clear();
}
