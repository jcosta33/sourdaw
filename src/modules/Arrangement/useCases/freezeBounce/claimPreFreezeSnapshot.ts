import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';

import { preFreezeSnapshots } from './preFreezeSnapshots';

/**
 * A freeze that starts while another one is running must inherit the running one's snapshot:
 * the live state then reads `freezing`, and restoring that would leave the track stuck on it.
 * A cancelled freeze leaves the track reading `freezing` until its own exit settles it, so a
 * freeze started in that window inherits the stored snapshot too.
 */
export function claimPreFreezeSnapshot(
    trackId: string,
    liveSnapshot: FreezeStateSnapshot,
    anotherFreezeIsActive: boolean
): FreezeStateSnapshot {
    const mayInherit = anotherFreezeIsActive || liveSnapshot.freezeState.status === 'freezing';
    const inherited = mayInherit ? preFreezeSnapshots.get(trackId) : undefined;
    if (inherited) {
        return inherited;
    }
    preFreezeSnapshots.set(trackId, liveSnapshot);
    return liveSnapshot;
}
