import { countSettledOverdubPasses, isOverdubLanding, waitForOverdubLanding } from '#/modules/MIDI/useCases';

import type { createNativeRecordingCaptureClock } from '#/modules/AudioEngine/useCases';
import type { NativeCaptureSnapshot, NativeCaptureBoundary } from './nativeRecordingCaptureHistory';

type NativeCaptureReader = () => ReturnType<ReturnType<typeof createNativeRecordingCaptureClock>['read']>;

type CaptureClockObserver = (
    beat: number,
    contextSeconds: number,
    relocated: boolean,
    effectiveFromContextSeconds?: number,
    songSeconds?: number,
    nativeOutput?: boolean,
    nativeBoundary?: NativeCaptureBoundary,
    nativeSnapshot?: NativeCaptureSnapshot
) => void;

type RecordingLifecycle = {
    readonly countInTimerId: ReturnType<typeof setTimeout> | null;
    /** How many take commits and overdub passes have settled, whether they landed or were retired. */
    readonly settledCommitCount: number;
    beginPendingRecordingStart: () => number;
    cancelPendingRecordingStart: () => void;
    completePendingRecordingStart: (token: number) => boolean;
    hasPendingRecordingStart: () => boolean;
    /** True while a stop is still closing a recording, or a tracked take commit is in flight. */
    isClosingRecording: () => boolean;
    /** The latest start request, including one whose pending phase has completed. */
    isLatestRecordingStart: (token: number) => boolean;
    ownsPendingRecordingStart: (token: number) => boolean;
    setCountInTimerId: (id: ReturnType<typeof setTimeout> | null) => void;
    /** Own the synchronous ending snapshot until this capture settles. */
    registerEnding: (end: () => void) => () => void;
    endRecording: () => void;
    registerCaptureClock: (observe: CaptureClockObserver) => () => void;
    registerNativeCaptureClock: (read: NativeCaptureReader, readSourceStart?: () => number | null) => () => void;
    readNativeCaptureClock: () => ReturnType<NativeCaptureReader> | undefined;
    readNativeCaptureSourceStart: () => number | null;
    observeCaptureClock: CaptureClockObserver;
    /** Own the stop that is closing a recording, so every later stop and the idle check can see it. */
    trackClosing: (closing: Promise<void>) => void;
    /** Own the commit a capture terminal started, so a stop can await it. */
    trackCommit: (commit: Promise<void | 'refused'>) => void;
    /**
     * Track a stop's promise for the settled-TAKE count: a stop that resolved `refused`
     * (#5517) closed nothing, so it must not read as a take this
     * project gained. Failures still count — a discarded take is a settled
     * gesture the #4439 semantics keep counting.
     */
    trackTakeCommit: (commit: Promise<'refused' | 'closed'>) => void;
    /** Resolve once every closing stop has settled, including ones registered while waiting. */
    waitForClosing: () => Promise<void>;
    /**
     * Resolve once `isClosingRecording` is false: every closing stop, tracked
     * commit and overdub landing has settled. Unlike `waitForCommits` it takes
     * nothing from the stops, so a caller other than a stop may use it.
     */
    waitUntilRecordingClosed: () => Promise<void>;
    /**
     * Resolve once every tracked commit has settled, including ones registered while waiting.
     * Only a stop may call it: it takes the commits it awaits away from every later caller.
     */
    waitForCommits: () => Promise<void>;
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
const recordingEndings = new Set<() => void>();
const recordingClocks = new Set<CaptureClockObserver>();
const nativeCaptureReaders = new Set<NativeCaptureReader>();
const nativeSourceStarts = new Map<NativeCaptureReader, () => number | null>();

const pendingCommits = new Set<Promise<void | 'refused'>>();

/** Every tracked commit that has not settled yet; each one removes itself as it settles. */
const commitsInFlight = new Set<Promise<void>>();

/**
 * Stops that are still closing a recording. A user's Pause or Stop turns the
 * transport idle synchronously and then awaits the recorder's flush and the
 * commit, so the transport state alone cannot say that a take is still landing.
 */
const closingStops = new Set<Promise<void>>();

function isClosingRecording(): boolean {
    return closingStops.size > 0 || commitsInFlight.size > 0 || isOverdubLanding();
}

function trackTakeCommit(commit: Promise<'refused' | 'closed'>): void {
    const onSettled = (outcome?: 'refused' | 'closed'): void => {
        commitsInFlight.delete(settled);
        if (outcome !== 'refused') {
            settledCommitCount++;
        }
    };
    const settled = commit.then(
        (outcome) => onSettled(outcome),
        () => onSettled()
    );
    commitsInFlight.add(settled);
    pendingCommits.add(
        commit.then((outcome) => {
            void outcome;
        })
    );
}

function trackCommit(commit: Promise<void | 'refused'>): void {
    const onSettled = (outcome?: void | 'refused'): void => {
        commitsInFlight.delete(settled);
        if (outcome !== 'refused') {
            settledCommitCount++;
        }
    };
    // Registered before any waiter can be, and reactions run in registration
    // order, so a waiter resumes only once the commit counts as settled.
    const settled = commit.then(onSettled, () => onSettled());
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

async function waitUntilRecordingClosed(): Promise<void> {
    // Each pass awaits what is closing now; a stop, commit or landing that
    // registers meanwhile keeps `isClosingRecording` true for the next pass.
    while (isClosingRecording()) {
        await waitForClosing();
        await Promise.allSettled([...commitsInFlight]);
        await waitForOverdubLanding();
    }
}

export const recordingLifecycle: RecordingLifecycle = {
    get countInTimerId() {
        return countInTimerId;
    },
    get settledCommitCount() {
        return settledCommitCount + countSettledOverdubPasses();
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
    isClosingRecording,
    isLatestRecordingStart: (token) => nextRecordingStartToken === token,
    ownsPendingRecordingStart: (token) => pendingRecordingStartToken === token,
    setCountInTimerId: (id) => {
        countInTimerId = id;
    },
    registerEnding: (end) => {
        recordingEndings.add(end);
        return () => {
            recordingEndings.delete(end);
        };
    },
    endRecording: () => {
        const endings = [...recordingEndings];
        recordingEndings.clear();
        for (const end of endings) {
            end();
        }
    },
    registerCaptureClock: (observe) => {
        recordingClocks.add(observe);
        return () => {
            recordingClocks.delete(observe);
        };
    },
    registerNativeCaptureClock: (read, readSourceStart) => {
        nativeCaptureReaders.add(read);
        if (readSourceStart) {
            nativeSourceStarts.set(read, readSourceStart);
        }
        return () => {
            nativeCaptureReaders.delete(read);
            nativeSourceStarts.delete(read);
        };
    },
    readNativeCaptureClock: () => nativeCaptureReaders.values().next().value?.(),
    readNativeCaptureSourceStart: () => {
        const reader = nativeCaptureReaders.values().next().value;
        return reader ? (nativeSourceStarts.get(reader)?.() ?? null) : null;
    },
    observeCaptureClock: (
        beat,
        contextSeconds,
        relocated,
        effectiveFromContextSeconds,
        songSeconds,
        nativeOutput,
        nativeBoundary,
        nativeSnapshot
    ) => {
        for (const observe of recordingClocks) {
            observe(
                beat,
                contextSeconds,
                relocated,
                effectiveFromContextSeconds,
                songSeconds,
                nativeOutput,
                nativeBoundary,
                nativeSnapshot
            );
        }
    },
    trackClosing,
    trackCommit,
    trackTakeCommit,
    waitForClosing,
    waitForCommits,
    waitUntilRecordingClosed,
};
