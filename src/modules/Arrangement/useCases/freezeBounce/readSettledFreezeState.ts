import { settleFreezingSnapshot } from '#/utils/settleFreezingSnapshot';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { type Track } from '../../stores/trackStore';

import { captureFreezeStateSnapshot } from './freezeStateSnapshot';
import { settledBeforeFreeze } from './settledBeforeFreeze';

/**
 * The state a freeze starting now on `track` would exit to, read without remembering anything.
 * A track showing `freezing` is mid-render, so its live state is not a state to undo back to: the
 * remembered settled state of the running freeze stands in, or the snapshot settled when none is kept.
 * Any other status is captured as it is.
 */
export function readSettledFreezeState(track: Track): FreezeStateSnapshot {
    const remembered = settledBeforeFreeze.get(track.id);
    if (track.freezeState.status === 'freezing' && remembered) {
        return remembered;
    }
    return settleFreezingSnapshot(captureFreezeStateSnapshot(track));
}
