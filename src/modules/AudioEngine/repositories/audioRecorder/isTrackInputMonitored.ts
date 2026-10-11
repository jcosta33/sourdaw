import { inputMonitoringSession, type MonitorCaptureKey } from './inputMonitoringSession';

/**
 * Whether a track currently holds interest in the capture of this key, whether
 * its edge is connected or its acquisition is still in flight. A refused grant
 * drops the interest, so a refusal reads as not monitored.
 */
export function isTrackInputMonitored(trackId: string, key: MonitorCaptureKey): boolean {
    return inputMonitoringSession.trackKeys.get(trackId) === key;
}
