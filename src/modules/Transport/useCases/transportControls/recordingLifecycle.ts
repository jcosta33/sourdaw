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
    /**
     * Resolve once every tracked commit has settled, including ones registered while waiting.
     * Only a stop may call it: it takes the commits it awaits away from every later caller.
     */
    waitForCommits: () => Promise<void>;
    /** Resolve once no stop is closing and no commit is in flight, without taking either from a stop. */
    waitUntilQuiet: () => Promise<void>;
};

let countInTimerId: ReturnType<typeof setTimeout> | null = null;
let nextRecordingStartToken = 0;
let pendingRecordingStartToken: number | null = null;
let settledCommitCount = 0;

/**
 * Commit promises a capture terminal started but nobody awaits. The terminal
 * runs inside the audio flush, so a stop that waited only on the flush could let
 * the next Undo act on the previous history entry while this gesture's commit
 * was still in flight (#4439). The lifecycle owns them so the stop path can wait
 * for the entry — the scheduler never does, because it must not block on it.
 * `waitForCommits` empties it, so it belongs to the stops alone.
 */
const pendingCommits = new Set<Promise<void>>();

/** Every tracked commit that has not settled yet; each one removes itself as it settles. */
const commitsInFlight = new Set<Promise<void>>();

/**
 * Stops that are still closing a recording. A user's Pause or Stop turns the
 * transport idle synchronously and then awaits the recorder's flush and the
 * commit, so the transport state alone cannot say that a take is still landing.
 */
const closingStops = new Set<Promise<void>>();

/** Callers of `waitUntilQuiet`, woken by the settlement that leaves nothing closing. */
const quietWaiters: (() => void)[] = [];

function isQuiet(): boolean {
    return closingStops.size === 0 && commitsInFlight.size === 0;
}

function wakeQuietWaiters(): void {
    if (!isQuiet()) {
        return;
    }
    for (const wake of quietWaiters.splice(0)) {
        wake();
    }
}

function waitUntilQuiet(): Promise<void> {
    if (isQuiet()) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        quietWaiters.push(resolve);
    });
}

function trackCommit(commit: Promise<void>): void {
    const onSettled = (): void => {
        commitsInFlight.delete(settled);
        settledCommitCount++;
        wakeQuietWaiters();
    };
    // Registered before any waiter can be, and reactions run in registration
    // order, so a waiter resumes only once the commit counts as settled.
    const settled = commit.then(onSettled, onSettled);
    commitsInFlight.add(settled);
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
    const onSettled = (): void => {
        closingStops.delete(settled);
        wakeQuietWaiters();
    };
    const settled = closing.then(onSettled, onSettled);
    closingStops.add(settled);
}

async function waitForClosing(): Promise<void> {
    // Forgets what it awaited, as `waitForCommits` does, so the wait ends on its
    // own settlement and never on a settle observer having run.
    while (closingStops.size > 0) {
        const closing = [...closingStops];
        await Promise.allSettled(closing);
        for (const settled of closing) {
            closingStops.delete(settled);
        }
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
    isClosingRecording: () => !isQuiet(),
    ownsPendingRecordingStart: (token) => pendingRecordingStartToken === token,
    setCountInTimerId: (id) => {
        countInTimerId = id;
    },
    trackClosing,
    trackCommit,
    waitForClosing,
    waitForCommits,
    waitUntilQuiet,
};
