import { crumbsRecordFeedSession } from './crumbsRecordFeedSession';
import { inputMonitoringSession } from './inputMonitoringSession';

/**
 * Connect the live monitor source to a live tap, if both exist.
 *
 * Called when input monitoring starts (or re-connects its strips) while a
 * crumbs recording is armed: the monitored input bus is the record feed's
 * one and only source, so an arm that predates the bus attaches here.
 */
export function attachCrumbsRecordFeedToMonitorSource(): void {
    const { monitorSource } = inputMonitoringSession;
    if (crumbsRecordFeedSession.armedInstances.size > 0 && crumbsRecordFeedSession.handle && monitorSource) {
        crumbsRecordFeedSession.handle.attachTo(monitorSource);
    }
}
