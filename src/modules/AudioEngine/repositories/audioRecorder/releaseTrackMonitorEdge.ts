import { runAllEffects } from '#/utils/runEffects';

import { inputMonitoringSession, monitorOwnersFor, type MonitorCaptureKey } from './inputMonitoringSession';
import { releaseMonitorCapture } from './releaseMonitorCapture';

/**
 * Removes one track's listening edge and its ownership of the key it monitors.
 *
 * The capture of that key stays live while any other track still owns an edge
 * on it, and only the last owner releases the stream. A still-pending
 * acquisition keeps its request in flight instead of being orphaned: losing one
 * owner is not proof the key is unwanted, and a superseded grant is decided at
 * settlement, where no owner remains by definition.
 */
export function releaseTrackMonitorEdge(trackId: string, key: MonitorCaptureKey): void {
    const capture = inputMonitoringSession.captures.get(key);
    if (!capture) {
        return;
    }
    const destination = capture.monitorEdges.get(trackId);
    if (destination !== undefined) {
        capture.monitorEdges.delete(trackId);
    }
    runAllEffects([
        () => {
            if (destination !== undefined) {
                capture.monitorSource.disconnect(destination);
            }
        },
        () => {
            if (monitorOwnersFor(key).size === 0) {
                releaseMonitorCapture(key);
            }
        },
    ]);
}
