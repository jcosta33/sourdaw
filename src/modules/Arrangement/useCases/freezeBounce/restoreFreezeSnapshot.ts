import { type captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';

import { type FreezeStateSnapshot } from '../../events/arrangementTrackSnapshots';
import { updateTrack } from '../../repositories/track/updateTrack';

/**
 * Puts a track back on the freeze state it had before a cancelled freeze began. A cancelled
 * refresh keeps the take it was replacing, so the track stays frozen on it and can still be
 * unfrozen; a cancelled first freeze is unfrozen.
 */
export function restoreFreezeSnapshot(
    scope: ReturnType<typeof captureAutomergeStorageTransactionScope>,
    trackId: string,
    snapshot: FreezeStateSnapshot
): void {
    scope(() => {
        updateTrack(trackId, (time) => ({
            ...time,
            frozen: snapshot.frozen,
            frozenBufferId: snapshot.frozenBufferId,
            freezeState: snapshot.freezeState,
        }));
    });
}
