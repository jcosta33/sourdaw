import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore } from '../../stores/trackStore';

import { freezeStateSnapshotMatches } from './freezeStateSnapshotMatches';

/**
 * A cancelled freeze exiting late. `cancelFreezeTrack` already settled the track, so this writes
 * only while the track still shows the freezing state this task wrote, and never over a later
 * freeze's state, error, or a committed take that was unfrozen since. Returns whether it wrote.
 */
export function restoreCancelledFreeze(input: {
    trackId: string;
    pendingFreeze: FreezeStateSnapshot | null;
    settled: FreezeStateSnapshot;
    scope: (write: () => void) => void;
}): boolean {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === input.trackId);
    if (!track || !input.pendingFreeze || !freezeStateSnapshotMatches(track, input.pendingFreeze)) {
        return false;
    }
    input.scope(() => {
        updateTrack(input.trackId, (time) => ({
            ...time,
            frozen: input.settled.frozen,
            frozenBufferId: input.settled.frozenBufferId,
            freezeState: input.settled.freezeState,
        }));
    });
    return true;
}
