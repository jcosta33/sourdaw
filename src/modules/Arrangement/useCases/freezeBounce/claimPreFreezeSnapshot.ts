import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';

import { preFreezeSnapshots } from './preFreezeSnapshots';

/**
 * A freeze that starts while another one is running must inherit the running one's snapshot:
 * the live state then reads `freezing`, and restoring that would leave the track stuck on it.
 */
export function claimPreFreezeSnapshot(
    trackId: string,
    liveSnapshot: FreezeStateSnapshot,
    anotherFreezeIsActive: boolean
): FreezeStateSnapshot {
    const inherited = anotherFreezeIsActive ? preFreezeSnapshots.get(trackId) : undefined;
    if (inherited) {
        return inherited;
    }
    preFreezeSnapshots.set(trackId, liveSnapshot);
    return liveSnapshot;
}
