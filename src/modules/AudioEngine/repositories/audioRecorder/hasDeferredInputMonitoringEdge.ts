import { inputMonitoringSession } from './inputMonitoringSession';

/** A grant retained through optimistic removal is attached only when the owner returns. */
export function hasDeferredInputMonitoringEdge(trackId: string): boolean {
    const key = inputMonitoringSession.trackKeys.get(trackId);
    if (key === undefined) {
        return false;
    }
    const capture = inputMonitoringSession.captures.get(key);
    return capture !== undefined && !capture.monitorEdges.has(trackId);
}
