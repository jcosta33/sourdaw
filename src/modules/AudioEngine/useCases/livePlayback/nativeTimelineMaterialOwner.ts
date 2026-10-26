import { nativeTimelineMaterialLeases } from '../../repositories/nativeGraph/nativeTimelineMaterialLeases';

/** End the outgoing runtime generation. Cancellation reconstructs a fresh one. */
export function nativeTimelineMaterialOwner(): Promise<void> {
    return nativeTimelineMaterialLeases.retire();
}
