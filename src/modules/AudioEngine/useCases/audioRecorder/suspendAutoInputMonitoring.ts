import { holdAutoInputMonitoring, releaseAutoInputMonitoringHold } from '../../services/autoInputMonitoringSuspension';

import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/**
 * Stops the Auto input monitoring owner from acting on any store publication
 * until the returned resume runs, then settles the state the caller left behind
 * in one reconcile. For a rebuild that publishes a transport state it does not
 * mean to keep (a repair pauses a rolling transport and restarts it), so the
 * owner never sees "armed and stopped" for a transport that is playing.
 * Resuming twice does nothing.
 */
export function suspendAutoInputMonitoring(): () => void {
    holdAutoInputMonitoring();
    let held = true;
    return () => {
        if (!held) {
            return;
        }
        held = false;
        releaseAutoInputMonitoringHold();
        reconcileAutoInputMonitoring();
    };
}
