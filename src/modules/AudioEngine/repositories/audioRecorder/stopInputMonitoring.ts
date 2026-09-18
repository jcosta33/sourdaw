import { inputMonitoringSession } from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';

/**
 * Explicit global teardown: every listening edge, the shared capture and all
 * pending interest. This is not the implementation of one track's mode change
 * — that is `stopTrackInputMonitoring`, which preserves other tracks' edges.
 */
export function stopInputMonitoring(): void {
    for (const trackId of [...inputMonitoringSession.monitorEdges.keys()]) {
        const destination = inputMonitoringSession.monitorEdges.get(trackId);
        inputMonitoringSession.monitorEdges.delete(trackId);
        if (destination !== undefined) {
            inputMonitoringSession.monitorSource?.disconnect(destination);
        }
    }
    inputMonitoringSession.pendingOwners.clear();
    // Orphan an unresolved request: its settlement releases the late stream
    // exactly once, and a fresh start after teardown acquires its own capture.
    inputMonitoringSession.pendingRequest = null;
    releaseMonitorCapture();
}
