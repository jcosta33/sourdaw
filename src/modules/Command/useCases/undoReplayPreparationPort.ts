import { type UndoEntry } from '../models/UndoEntry';

/** Releases what one preparation retained. */
type UndoReplayRelease = () => void;

/**
 * Readies what the given entries need before they replay, and returns the
 * release to run once they have applied or failed.
 */
type UndoReplayPreparationProvider = (entries: readonly UndoEntry[]) => Promise<UndoReplayRelease>;

let provider: UndoReplayPreparationProvider | null = null;

/**
 * Seam for resources an undo or redo replay needs and the history does not
 * keep live: the audio cache may evict a buffer only the history names once
 * its PCM is durably stored, so before an entry's inverse or redo runs the
 * provider puts that buffer back and holds it until the replay settles.
 * Command must not import the modules that own those resources, so the
 * composition root injects the provider. With none registered, replays run
 * as they are.
 */
export const undoReplayPreparationPort = {
    setProvider(next: UndoReplayPreparationProvider | null): void {
        provider = next;
    },
};

/** Runs `replay` once `entries` are ready, releasing what was readied when it settles. */
export async function runPreparedUndoReplay<Result>(
    entries: readonly UndoEntry[],
    replay: () => Promise<Result>
): Promise<Result> {
    if (!provider) {
        return replay();
    }
    const release = await provider(entries);
    try {
        return await replay();
    } finally {
        release();
    }
}
