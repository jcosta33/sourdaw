import { startCrumbsRecordFeed as startCrumbsRecordFeedRepo } from '../../repositories/audioRecorder/crumbsRecordFeed';

/**
 * Arm the monitored-input record feed for the native crumbs sampler.
 *
 * Called by the crumbs arm use case after the native arm is accepted. The tap
 * this installs is what feeds armed pads — without it the native record
 * bridges have no producer and an armed capture records silence. Idempotent,
 * and a no-op outside the desktop app.
 */
export function startCrumbsRecordFeed(): void {
    startCrumbsRecordFeedRepo();
}
