type RecordingLifecycle = {
    readonly countInTimerId: ReturnType<typeof setTimeout> | null;
    /** How many take commits have settled, whether they landed or were retired. */
    readonly settledCommitCount: number;
    beginPendingRecordingStart: () => number;
    cancelPendingRecordingStart: () => void;
    completePendingRecordingStart: (token: number) => boolean;
    hasPendingRecordingStart: () => boolean;
    /** True while a stop is still closing a recording, or a tracked take commit is in flight. */
    isClosingRecording: () => boolean;
    ownsPendingRecordingStart: (token: number) => boolean;
    setCountInTimerId: (id: ReturnType<typeof setTimeout> | null) => void;
    /** Own the stop that is closing a recording, so every later stop and the idle check can see it. */
    trackClosing: (closing: Promise<void>) => void;
    /** Own the commit a capture terminal started, so a stop can await it. */
    trackCommit: (commit: Promise<void>) => void;
    /** Resolve once every closing stop has settled, including ones registered while waiting. */
    waitForClosing: () => Promise<void>;
    /** Resolve once every tracked commit has settled, including ones registered while waiting. */
    waitForCommits: () => Promise<void>;
};

let countInTimerId: ReturnType<typeof setTimeout> | null = null;
let nextRecordingStartToken = 0;
let pendingRecordingStartToken: number | null = null;
let commitsInFlight = 0;
let settledCommitCount = 0;

/**
 * Commit promises a capture terminal started but nobody awaits. The terminal
 * runs inside the audio flush, so a stop that waited only on the flush could let
 * the next Undo act on the previous history entry while this gesture's commit
 * was still in flight (#4439). The lifecycle owns them so the stop path can wait
 * for the entry — the scheduler never does, because it must not block on it.
 */
const pendingCommits = new Set<Promise<void>>();

/**
 * Stops that are still closing a recording. A user's Pause or Stop turns the
 * transport idle synchronously and then awaits the recorder's flush and the
 * commit, so the transport state alone cannot say that a take is still landing.
 */
const closingStops = new Set<Promise<void>>();

function onCommitSettled(): void {
    commitsInFlight--;
    settledCommitCount++;
}

function trackCommit(commit: Promise<void>): void {
    commitsInFlight++;
    // Registered before any waiter can be, and reactions run in registration
    // order, so a waiter resumes only once the commit counts as settled.
    void commit.then(onCommitSettled, onCommitSettled);
    pendingCommits.add(commit);
}

async function waitForCommits(): Promise<void> {
    // Snapshot and clear before awaiting: a commit registered while this waits is
    // handled by the next pass, and a settle observer is never what decides
    // whether the loop can end — one that never runs would otherwise spin here.
    while (pendingCommits.size > 0) {
        const commits = [...pendingCommits];
        pendingCommits.clear();
        await Promise.allSettled(commits);
    }
}

function trackClosing(closing: Promise<void>): void {
    const settled = closing.then(
        () => {
            closingStops.delete(settled);
        },
        () => {
            closingStops.delete(settled);
        }
    );
    closingStops.add(settled);
}

async function waitForClosing(): Promise<void> {
    while (closingStops.size > 0) {
        await Promise.allSettled([...closingStops]);
    }
}

export const recordingLifecycle: RecordingLifecycle = {
    get countInTimerId() {
        return countInTimerId;
    },
    get settledCommitCount() {
        return settledCommitCount;
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
    isClosingRecording: () => closingStops.size > 0 || commitsInFlight > 0,
    ownsPendingRecordingStart: (token) => pendingRecordingStartToken === token,
    setCountInTimerId: (id) => {
        countInTimerId = id;
    },
    trackClosing,
    trackCommit,
    waitForClosing,
    waitForCommits,
};
