import { inputMonitoringSession } from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';

/**
 * Removes one track's listening edge.
 *
 * Changing one track's monitoring mode must route here: the shared capture
 * stays live while any other track still owns an edge, and only the last
 * owner releases the stream. A still-pending acquisition merely loses this
 * track as an interested owner, so a late grant is never connected for it.
 */
export function stopTrackInputMonitoring(trackId: string): void {
    inputMonitoringSession.pendingOwners.delete(trackId);
    const destination = inputMonitoringSession.monitorEdges.get(trackId);
    if (destination === undefined) {
        return;
    }
    inputMonitoringSession.monitorEdges.delete(trackId);
    inputMonitoringSession.monitorSource?.disconnect(destination);
    if (inputMonitoringSession.monitorEdges.size === 0) {
        releaseMonitorCapture();
    }
}
