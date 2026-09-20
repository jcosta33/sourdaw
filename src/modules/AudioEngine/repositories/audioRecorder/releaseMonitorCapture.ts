import { inputMonitoringSession, type MonitorCaptureKey } from './inputMonitoringSession';
import { stopStreamTracks } from './stopStreamTracks';

/**
 * Releases one key's capture: the source disconnects from everything and the
 * stream's device tracks stop exactly once. Removing the capture before either
 * stop makes a repeated release a no-op instead of a second stop. Callers
 * guarantee that no per-track edge remains on this key.
 */
export function releaseMonitorCapture(key: MonitorCaptureKey): void {
    const capture = inputMonitoringSession.captures.get(key);
    if (!capture) {
        return;
    }
    inputMonitoringSession.captures.delete(key);
    capture.monitorSource.disconnect();
    stopStreamTracks(capture.monitorStream);
}
