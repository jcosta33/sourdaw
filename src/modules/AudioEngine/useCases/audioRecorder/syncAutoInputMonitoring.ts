import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { reconcileAutoInputMonitoring } from './reconcileAutoInputMonitoring';

/**
 * Subscribe Auto monitoring to the track and transport stores, settling the
 * state held at setup first. Returns the unsubscribe.
 */
export function syncAutoInputMonitoring(): () => void {
    reconcileAutoInputMonitoring();
    const unsubscribeTracks = trackStore.subscribe(reconcileAutoInputMonitoring);
    const unsubscribeTransport = transportStore.subscribe(reconcileAutoInputMonitoring);
    return () => {
        unsubscribeTracks();
        unsubscribeTransport();
    };
}
