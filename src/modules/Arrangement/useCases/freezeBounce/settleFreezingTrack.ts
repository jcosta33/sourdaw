import { settleFreezingSnapshot } from '#/utils/settleFreezingSnapshot';

import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore } from '../../stores/trackStore';

import { captureFreezeStateSnapshot } from './freezeStateSnapshot';
import { settledBeforeFreeze } from './settledBeforeFreeze';

/**
 * Writes the settled state back onto a track that still shows `freezing`. Does nothing for any
 * other status, so a later freeze's error, a committed take, or an unfreeze are never overwritten
 * by an earlier freeze that exits late.
 */
export function settleFreezingTrack(trackId: string): void {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    const remembered = settledBeforeFreeze.get(trackId);
    settledBeforeFreeze.delete(trackId);
    if (!track || track.freezeState.status !== 'freezing') {
        return;
    }
    const settled = remembered ?? settleFreezingSnapshot(captureFreezeStateSnapshot(track));
    updateTrack(trackId, (candidate) => ({
        ...candidate,
        frozen: settled.frozen,
        frozenBufferId: settled.frozenBufferId,
        freezeState: settled.freezeState,
    }));
}
