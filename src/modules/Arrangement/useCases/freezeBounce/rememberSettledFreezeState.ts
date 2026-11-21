import { settleFreezingSnapshot } from '#/utils/settleFreezingSnapshot';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { type Track } from '../../stores/trackStore';

import { captureFreezeStateSnapshot } from './freezeStateSnapshot';
import { settledBeforeFreeze } from './settledBeforeFreeze';

/** The state to restore for a freeze that starts now on `track`, remembered until the freeze exits. */
export function rememberSettledFreezeState(track: Track): FreezeStateSnapshot {
    const remembered = settledBeforeFreeze.get(track.id);
    if (track.freezeState.status === 'freezing' && remembered) {
        return remembered;
    }
    const settled = settleFreezingSnapshot(captureFreezeStateSnapshot(track));
    settledBeforeFreeze.set(track.id, settled);
    return settled;
}
