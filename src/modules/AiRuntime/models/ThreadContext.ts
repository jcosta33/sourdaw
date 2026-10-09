/**
 * The user requests a thread reaches back over: the window opens at the oldest of the thread's
 * most recent requests this many, and a pending proposal or a commit is thread state only while
 * the message that carries it is inside that window.
 */
export const THREAD_CONTEXT_MAX_TURNS = 16;

/**
 * The UTF-8 bytes the serialized `thread_context` section may take, per message profile. Each is
 * part of its message's budget, never an addition to it. The hosted message carries its receipt and
 * capability evidence at 8,192 characters each, and the thread sits beside them at twice that. The
 * local share is what the default local model's window has left when a five-track project's
 * receipt turn at the evidence ceiling has taken its prompt and the reply reserve: the local budget
 * never charges a text more than a token a byte, so a section at this cap still fits however
 * identifier-dense it is.
 */
export const THREAD_CONTEXT_MAX_BYTES = { hosted: 16_384, local: 6_144 } as const;

/**
 * One command of a proposal or commit, as the thread states it: its name, the label the approval
 * card showed for it, which is the proposal's summary line for that command, and its arguments
 * when the thread still holds them.
 */
export type ThreadCommand = {
    name: string;
    label: string;
    arguments?: Record<string, unknown>;
};

/** One `preview − baseline` figure a measured preview of the committed batch reported. */
export type ThreadMeasuredDelta = {
    targetId: string;
    metric: string;
    delta: number;
    unit: string;
};

/**
 * What a chat thread holds when a new request is planned: its earlier requests, oldest first, the
 * proposal still waiting for the user, and the last run of the thread that committed. It exists
 * only while a proposal is pending or a commit sits inside the window; a thread with neither has
 * no state for the planner.
 */
export type ThreadContext = {
    requests: string[];
    pendingProposal: { runId: string; commands: ThreadCommand[] } | null;
    lastCommit: {
        runId: string;
        receiptIds: string[];
        reverted: boolean;
        commands: ThreadCommand[];
        measuredDeltas: ThreadMeasuredDelta[];
    } | null;
};

/** What one profile's `thread_context` section kept and left out: counts and bytes, never thread text. */
export type ThreadContextEvidence = {
    requestCount: number;
    omittedRequestCount: number;
    pendingProposal: boolean;
    pendingCommandCount: number;
    omittedPendingCommandCount: number;
    lastCommit: boolean;
    committedCommandCount: number;
    omittedCommittedCommandCount: number;
    measuredDeltaCount: number;
    omittedMeasuredDeltaCount: number;
    bytes: number;
};
