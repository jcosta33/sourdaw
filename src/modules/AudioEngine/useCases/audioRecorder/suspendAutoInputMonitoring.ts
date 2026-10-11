import { holdAutoInputMonitoring, releaseAutoInputMonitoringHold } from '../../services/autoInputMonitoringSuspension';

import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/**
 * Stops the Auto input monitoring owner from opening any edge until the
 * returned resume runs, then settles the state the caller left behind in one
 * reconcile. The owner keeps following transitions and closing edges, so only
 * the opens wait. For a rebuild that publishes a transport state it does not
 * mean to keep (a repair pauses a rolling transport and restarts it), so the
 * owner never opens an edge for "armed and stopped" under a transport that is
 * playing. Resuming twice does nothing.
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
