import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { subscribeToInputMonitoringProjectChanges } from '../../stores/inputMonitoringProjectAccess';

import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/**
 * Subscribe the monitoring owner to track, transport and committed-project
 * changes, settling the state held at setup first. Returns the unsubscribe.
 */
export function syncAutoInputMonitoring(): () => void {
    reconcileAutoInputMonitoring();
    const unsubscribeTracks = trackStore.subscribe(reconcileAutoInputMonitoring);
    const unsubscribeTransport = transportStore.subscribe(reconcileAutoInputMonitoring);
    // A local commit can leave the visible store unchanged, so its publication
    // alone cannot settle an optimistic removal's committed-owner veto.
    const unsubscribeProject = subscribeToInputMonitoringProjectChanges(reconcileAutoInputMonitoring);
    return () => {
        unsubscribeTracks();
        unsubscribeTransport();
        unsubscribeProject();
    };
}
