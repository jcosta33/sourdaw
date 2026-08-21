import { stopCrumbsRecordFeed as stopCrumbsRecordFeedRepo } from '../../repositories/audioRecorder/stopCrumbsRecordFeed';

/**
 * Disarm the monitored-input record feed for one crumbs instance.
 *
 * The shared tap stays up while any other instance is still armed, and comes
 * down when the last one stops — so ending one take never silences another.
 * Called before the native stop, so no straggler block lands on the bridge
 * after the take closes. Idempotent.
 */
export function stopCrumbsRecordFeed(instanceId: string): void {
    stopCrumbsRecordFeedRepo(instanceId);
}
