import { type captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { trackStore } from '../../stores/trackStore';

import { freezeStateSnapshotMatches } from './freezeStateSnapshotMatches';
import { preFreezeSnapshots } from './preFreezeSnapshots';
import { restoreFreezeSnapshot } from './restoreFreezeSnapshot';

/**
 * Ends a cancelled freeze that no other freeze owns. The restore is conditional: it runs only
 * while the track still shows the `freezing` state this task wrote. A later freeze that failed,
 * or that committed and was unfrozen, has moved the track on, and putting this task's earlier
 * state back would overwrite it. The pre-freeze snapshot is dropped either way, since no task
 * is left to use it.
 */
export function settleCancelledFreeze(
    scope: ReturnType<typeof captureAutomergeStorageTransactionScope>,
    trackId: string,
    previousFreeze: FreezeStateSnapshot,
    pendingFreeze: FreezeStateSnapshot | null
): void {
    preFreezeSnapshots.delete(trackId);
    const liveTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!liveTrack || !pendingFreeze || !freezeStateSnapshotMatches(liveTrack, pendingFreeze)) {
        return;
    }
    restoreFreezeSnapshot(scope, trackId, previousFreeze);
}
