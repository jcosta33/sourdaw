import { padLatest, padPending } from './toasterPadParamQueue';

/**
 * Cancel any rAF coalescing in flight for a device and drop its queued
 * pad-param writes. Called on device teardown so a frame scheduled before
 * destroy() cannot fire after the device is gone.
 */
export function cancelPendingToasterPadParams(deviceId: string): void {
    for (const [cacheKey, pending] of padPending) {
        if (pending.deviceId === deviceId) {
            cancelAnimationFrame(pending.rafId);
            padPending.delete(cacheKey);
            padLatest.delete(cacheKey);
        }
    }
}
