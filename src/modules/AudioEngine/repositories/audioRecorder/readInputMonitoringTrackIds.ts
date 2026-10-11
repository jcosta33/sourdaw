import { inputMonitoringSession } from './inputMonitoringSession';

/** Snapshot admitted owners, including direct On requests still awaiting permission. */
export function readInputMonitoringTrackIds(): readonly string[] {
    return [...inputMonitoringSession.trackKeys.keys()];
}
