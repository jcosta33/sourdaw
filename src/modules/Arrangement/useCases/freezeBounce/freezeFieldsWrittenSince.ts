import { readRootListItemWritesSince } from '#/modules/CrdtDocument/useCases';

const FREEZE_FIELDS = ['frozen', 'frozenBufferId', 'freezeState'];
const TRACK_LIST_PATH = ['tracks', 'tracks'];

/**
 * Whether anything has written this track's `frozen`, `frozenBufferId` or `freezeState` in the
 * document since `heads`, whatever it wrote. A running freeze's own writes stay uncommitted until its
 * action ends, so a write found here is someone else's, and a value that merely equals the state the
 * freeze started from (a collaborator's unfreeze of a never-frozen track) still counts.
 *
 * `renderProgress` is progress, not freeze state: a local action that commits the track list carries
 * the freeze's own pending progress into the document with it, so it is not a foreign write.
 *
 * A track moved since `heads` is written whole as a new row, so its field writes cannot be told apart
 * from the move; the caller's value check alone decides then. Heads the document no longer holds (a
 * rollback discarded them) prove nothing, so they count as a write.
 */
export function freezeFieldsWrittenSince(heads: readonly string[], trackId: string): boolean {
    const writes = readRootListItemWritesSince({
        heads,
        listPath: TRACK_LIST_PATH,
        itemId: trackId,
        keys: FREEZE_FIELDS,
    });
    if (writes.status === 'unknown') {
        return true;
    }
    if (writes.status !== 'present') {
        return false;
    }
    return writes.writtenPaths.some((path) => !isRenderProgressWrite(path));
}

function isRenderProgressWrite(path: readonly string[]): boolean {
    return path[0] === 'freezeState' && path[1] === 'renderProgress';
}
