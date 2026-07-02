import { padLatest, padPending } from './toasterPadParamQueue';

/**
 * Cancel any rAF coalescing in flight for a device and drop its queued
 * pad-param writes. Called on device teardown so a frame scheduled before
 * destroy() cannot fire after the device is gone.
 */
export function cancelPendingToasterPadParams(deviceId: string): void {
    const prefix = `${deviceId}_`;
    for (const [cacheKey, rafId] of padPending) {
        if (cacheKey.startsWith(prefix)) {
            cancelAnimationFrame(rafId);
            padPending.delete(cacheKey);
            padLatest.delete(cacheKey);
        }
    }
}
