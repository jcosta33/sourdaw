import { type AppAction } from '#/utils/handlerContract';

import { type UndoEntry } from '../models/UndoEntry';

/** Releases what one preparation retained. */
type UndoReplayRelease = () => void;

/**
 * Readies what a replay needs before it runs, and returns the release to run
 * once it has applied or failed. `entries` are the undo entries the replay
 * applies; `actions` are actions it applies that no undo entry carries any
 * longer, such as an action history revert's retained inverse.
 */
type UndoReplayPreparationProvider = (
    entries: readonly UndoEntry[],
    actions: readonly AppAction[]
) => Promise<UndoReplayRelease>;

let provider: UndoReplayPreparationProvider | null = null;

/**
 * Seam for resources an undo or redo replay needs and the history does not
 * keep live: the audio cache may evict a buffer only the history names once
 * its PCM is durably stored, so before an entry's inverse or redo runs the
 * provider puts that buffer back and holds it until the replay settles.
 * Command must not import the modules that own those resources, so the
 * composition root injects the provider. A replay that runs before
 * `initAudioBufferCacheAccess()` in `src/app/initAudioBufferCacheAccess.ts`
 * fills it throws: a replay that skipped its preparation would restore a clip
 * whose evicted buffer is missing.
 */
export const undoReplayPreparationPort = {
    setProvider(next: UndoReplayPreparationProvider): void {
        provider = next;
    },
};

/** What one replay applies: the undo entries it runs, and any actions it runs
 * that no undo entry carries any longer, such as an action history revert's
 * retained inverse, which outlives the undo entry it came from. */
type UndoReplaySubjects = {
    readonly entries?: readonly UndoEntry[];
    readonly actions?: readonly AppAction[];
};

/** Runs `replay` once what it applies is ready, releasing what was readied when it settles. */
export async function runPreparedUndoReplay<Result>(
    { entries = [], actions = [] }: UndoReplaySubjects,
    replay: () => Promise<Result>
): Promise<Result> {
    if (!provider) {
        throw new Error(
            'runPreparedUndoReplay: no replay preparation provider is registered; call undoReplayPreparationPort.setProvider() from initAudioBufferCacheAccess() in src/app/initAudioBufferCacheAccess.ts'
        );
    }
    const release = await provider(entries, actions);
    try {
        return await replay();
    } finally {
        release();
    }
}
