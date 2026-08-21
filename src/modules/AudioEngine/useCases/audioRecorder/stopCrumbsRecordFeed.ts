import { stopCrumbsRecordFeed as stopCrumbsRecordFeedRepo } from '../../repositories/audioRecorder/crumbsRecordFeed';

/**
 * Disarm the monitored-input record feed.
 *
 * Called by the crumbs stop use case before the native stop, so no straggler
 * block lands on the bridge after the take closes. Idempotent.
 */
export function stopCrumbsRecordFeed(): void {
    stopCrumbsRecordFeedRepo();
}
