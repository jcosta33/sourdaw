import { inputMonitoringSession } from './inputMonitoringSession';
import { releaseTrackMonitorEdge } from './releaseTrackMonitorEdge';

/**
 * Removes one track's listening edge.
 *
 * Changing one track's monitoring mode must route here: the capture of the key
 * that track monitors stays live while any other track still owns an edge on
 * it, and only the last owner releases the stream.
 */
export function stopTrackInputMonitoring(trackId: string): void {
    const key = inputMonitoringSession.trackKeys.get(trackId);
    if (key === undefined) {
        return;
    }
    inputMonitoringSession.trackKeys.delete(trackId);
    releaseTrackMonitorEdge(trackId, key);
}
