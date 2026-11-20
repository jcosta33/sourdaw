import { kitPending } from './toasterKitParamQueue';

export function cancelPendingToasterKitParams(deviceId: string): void {
    for (const [key, entry] of kitPending) {
        if (entry.deviceId !== deviceId) {
            continue;
        }
        cancelAnimationFrame(entry.frame);
        kitPending.delete(key);
    }
}
