import { inputMonitoringSession } from './inputMonitoringSession';
import { stopStreamTracks } from './stopStreamTracks';

/**
 * Releases the shared monitor capture: the source disconnects from everything
 * and the stream's device tracks stop exactly once. Callers guarantee that no
 * per-track edge remains.
 */
export function releaseMonitorCapture(): void {
    if (inputMonitoringSession.monitorSource) {
        inputMonitoringSession.monitorSource.disconnect();
        inputMonitoringSession.monitorSource = null;
    }
    if (inputMonitoringSession.monitorStream) {
        stopStreamTracks(inputMonitoringSession.monitorStream);
        inputMonitoringSession.monitorStream = null;
    }
}
