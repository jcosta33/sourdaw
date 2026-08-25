import { crumbsRecordFeedSession, destroyCrumbsRecordFeedTap } from './crumbsRecordFeedSession';

/**
 * Disarm the record feed for one crumbs instance. The shared tap comes down
 * only when the last armed instance has stopped, so ending one take never
 * silences another instance's still-armed take — and a stop that leaves
 * someone armed never invalidates the tap a concurrent start is installing
 * for them. Idempotent per instance.
 */
export function stopCrumbsRecordFeed(instanceId: string): void {
    crumbsRecordFeedSession.armedInstances.delete(instanceId);
    if (crumbsRecordFeedSession.armedInstances.size > 0) {
        return;
    }
    // The last armed instance is gone: whatever start is still in flight is
    // now stale (its generation check destroys whatever it creates), and a
    // re-arm in the same window must begin a fresh start rather than trust
    // it.
    crumbsRecordFeedSession.generation += 1;
    crumbsRecordFeedSession.startingGeneration = null;
    destroyCrumbsRecordFeedTap();
}
