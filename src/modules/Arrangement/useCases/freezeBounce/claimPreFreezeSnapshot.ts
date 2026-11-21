import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';

import { preFreezeSnapshots } from './preFreezeSnapshots';

/**
 * A freeze that starts while another one is running, or after one was cancelled but has not
 * yet settled, finds the track reading `freezing`. It must inherit the stored snapshot then:
 * restoring `freezing` would leave the track stuck on it.
 */
export function claimPreFreezeSnapshot(trackId: string, liveSnapshot: FreezeStateSnapshot): FreezeStateSnapshot {
    const inherited = liveSnapshot.freezeState.status === 'freezing' ? preFreezeSnapshots.get(trackId) : undefined;
    if (inherited) {
        return inherited;
    }
    preFreezeSnapshots.set(trackId, liveSnapshot);
    return liveSnapshot;
}
