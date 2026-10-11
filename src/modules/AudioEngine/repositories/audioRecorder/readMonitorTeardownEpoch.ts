import { inputMonitoringSession } from './inputMonitoringSession';

/**
 * How many explicit global teardowns have run. An open that began under one
 * epoch and settles under another was cancelled by the teardown, so its
 * failure to connect says nothing about the device or the user's permission.
 */
export function readMonitorTeardownEpoch(): number {
    return inputMonitoringSession.teardownEpoch;
}
