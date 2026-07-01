import { inputMonitoringSession } from './inputMonitoringSession';

export function stopInputMonitoring(): void {
    if (inputMonitoringSession.monitorSource) {
        inputMonitoringSession.monitorSource.disconnect();
        inputMonitoringSession.monitorSource = null;
    }
    if (inputMonitoringSession.monitorStream) {
        for (const track of inputMonitoringSession.monitorStream.getTracks()) {
            track.stop();
        }
        inputMonitoringSession.monitorStream = null;
    }
}
