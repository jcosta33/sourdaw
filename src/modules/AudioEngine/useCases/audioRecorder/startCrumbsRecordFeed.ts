import { startCrumbsRecordFeed as startCrumbsRecordFeedRepo } from '../../repositories/audioRecorder/startCrumbsRecordFeed';

/**
 * Arm the monitored-input record feed for one native crumbs instance.
 *
 * Called by the crumbs arm use case after that instance's native arm is
 * accepted. The tap this arms is what feeds armed pads — without it the
 * native record bridges have no producer and an armed capture records
 * silence. The tap is shared: arming a second instance joins the live one.
 * Idempotent, and a no-op outside the desktop app.
 */
export function startCrumbsRecordFeed(instanceId: string): void {
    startCrumbsRecordFeedRepo(instanceId);
}
