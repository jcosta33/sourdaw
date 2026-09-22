type RecordingLifecycle = {
    readonly countInTimerId: ReturnType<typeof setTimeout> | null;
    beginPendingRecordingStart: () => number;
    cancelPendingRecordingStart: () => void;
    completePendingRecordingStart: (token: number) => boolean;
    hasPendingRecordingStart: () => boolean;
    ownsPendingRecordingStart: (token: number) => boolean;
    setCountInTimerId: (id: ReturnType<typeof setTimeout> | null) => void;
    /** Own the commit a capture terminal started, so a stop can await it. */
    trackCommit: (commit: Promise<void>) => void;
    /** Resolve once every tracked commit has settled, including ones registered while waiting. */
    waitForCommits: () => Promise<void>;
};

let countInTimerId: ReturnType<typeof setTimeout> | null = null;
let nextRecordingStartToken = 0;
let pendingRecordingStartToken: number | null = null;

/**
 * Commit promises a capture terminal started but nobody awaits. The terminal
 * runs inside the audio flush, so a stop that waited only on the flush could let
 * the next Undo act on the previous history entry while this gesture's commit
 * was still in flight (#4439). The lifecycle owns them so the stop path can wait
 * for the entry — the scheduler never does, because it must not block on it.
 */
const pendingCommits = new Set<Promise<void>>();

function trackCommit(commit: Promise<void>): void {
    pendingCommits.add(commit);
    // Drop a settled commit so one no stop ever waited on — a scheduler
    // punch-out — cannot be observed by an unrelated later stop.
    void commit.then(
        () => pendingCommits.delete(commit),
        () => pendingCommits.delete(commit)
    );
}

async function waitForCommits(): Promise<void> {
    // Re-check after each settle: a terminal can register while this waits.
    while (pendingCommits.size > 0) {
        await Promise.allSettled([...pendingCommits]);
    }
}

export const recordingLifecycle: RecordingLifecycle = {
    get countInTimerId() {
        return countInTimerId;
    },
    beginPendingRecordingStart: () => {
        const token = ++nextRecordingStartToken;
        pendingRecordingStartToken = token;
        return token;
    },
    cancelPendingRecordingStart: () => {
        pendingRecordingStartToken = null;
    },
    completePendingRecordingStart: (token) => {
        if (pendingRecordingStartToken !== token) {
            return false;
        }
        pendingRecordingStartToken = null;
        return true;
    },
    hasPendingRecordingStart: () => pendingRecordingStartToken !== null || countInTimerId !== null,
    ownsPendingRecordingStart: (token) => pendingRecordingStartToken === token,
    setCountInTimerId: (id) => {
        countInTimerId = id;
    },
    trackCommit,
    waitForCommits,
};
