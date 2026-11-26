import { getCrdtDoc, readRootPatchPathsSince } from '#/modules/CrdtDocument/useCases';

const FREEZE_FIELDS: ReadonlySet<string | number> = new Set(['frozen', 'frozenBufferId', 'freezeState']);
const TRACK_LIST_PATH = ['tracks', 'tracks'];
const TRACK_INDEX_DEPTH = TRACK_LIST_PATH.length;

type RootWithTracks = { tracks?: { tracks?: ReadonlyArray<{ id: string }> } };

function isFreezeFieldWrite(path: ReadonlyArray<string | number>): boolean {
    if (!TRACK_LIST_PATH.every((segment, index) => path[index] === segment)) {
        return false;
    }
    // A track written whole replaces its freeze fields too.
    return path.length === TRACK_INDEX_DEPTH + 1 || FREEZE_FIELDS.has(path[TRACK_INDEX_DEPTH + 1] ?? '');
}

/**
 * Whether anything has written a track's `frozen`, `frozenBufferId` or `freezeState` in the document
 * since `heads`, whatever it wrote. A running freeze's own writes stay uncommitted until its action
 * ends, so a write found here is someone else's, and a value that merely equals the state the freeze
 * started from (a collaborator's unfreeze of a never-frozen track) is told apart from a rebase that
 * only dropped the freeze's own write.
 */
export function freezeFieldsWrittenSince(heads: readonly string[], trackId: string): boolean {
    const tracks = getCrdtDoc<RootWithTracks>('root')?.tracks?.tracks;
    return readRootPatchPathsSince(heads).some((path) => {
        if (!isFreezeFieldWrite(path)) {
            return false;
        }
        const index = path[TRACK_INDEX_DEPTH];
        return typeof index === 'number' && tracks?.[index]?.id === trackId;
    });
}
