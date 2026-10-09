import {
    THREAD_CONTEXT_MAX_BYTES,
    type ThreadCommand,
    type ThreadContext,
    type ThreadContextEvidence,
    type ThreadMeasuredDelta,
} from '../models/ThreadContext';

import { type LlmActionMessageProfile } from './llmActionBridge';

/** Each earlier request is the user's own text, bounded like every other imported string. */
const MAX_THREAD_REQUEST_LENGTH = 512;
/** Bounds the receipt ids so the section's ids and counts alone always fit the smaller cap. */
const MAX_THREAD_RECEIPT_IDS = 8;
const MAX_THREAD_RECEIPT_ID_LENGTH = 128;

type FittedThread = {
    requests: string[];
    pendingCommands: ThreadCommand[];
    committedCommands: ThreadCommand[];
    measuredDeltas: ThreadMeasuredDelta[];
};

type FittedThreadContext = {
    section: string;
    evidence: ThreadContextEvidence;
    /** Whether the section carries measured figures, which a hosted request must declare as `measurement`. */
    carriesMeasurement: boolean;
};

function byteLength(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}

function serializePendingProposal(pending: ThreadContext['pendingProposal'], fitted: FittedThread) {
    if (pending === null) {
        return null;
    }
    return {
        trust: 'untrusted_project_data' as const,
        runId: pending.runId,
        commands: fitted.pendingCommands,
        omittedCommandCount: pending.commands.length - fitted.pendingCommands.length,
    };
}

function serializeLastCommit(commit: ThreadContext['lastCommit'], fitted: FittedThread) {
    if (commit === null) {
        return null;
    }
    return {
        trust: 'untrusted_project_data' as const,
        runId: commit.runId,
        receiptIds: commit.receiptIds
            .slice(-MAX_THREAD_RECEIPT_IDS)
            .map((receiptId) => receiptId.slice(0, MAX_THREAD_RECEIPT_ID_LENGTH)),
        reverted: commit.reverted,
        commands: fitted.committedCommands,
        omittedCommandCount: commit.commands.length - fitted.committedCommands.length,
        measuredDeltas: fitted.measuredDeltas,
        omittedMeasuredDeltaCount: commit.measuredDeltas.length - fitted.measuredDeltas.length,
    };
}

function serializeSection(thread: ThreadContext, fitted: FittedThread): string {
    const value = {
        requests: fitted.requests.map((request) => ({
            trust: 'untrusted_user_string' as const,
            value: request.slice(0, MAX_THREAD_REQUEST_LENGTH),
            truncated: request.length > MAX_THREAD_REQUEST_LENGTH,
        })),
        omittedRequestCount: thread.requests.length - fitted.requests.length,
        pendingProposal: serializePendingProposal(thread.pendingProposal, fitted),
        lastCommit: serializeLastCommit(thread.lastCommit, fitted),
    };
    return `thread_context:\n${JSON.stringify(value)}`;
}

function describeFit(thread: ThreadContext, fitted: FittedThread, bytes: number): ThreadContextEvidence {
    return {
        requestCount: fitted.requests.length,
        omittedRequestCount: thread.requests.length - fitted.requests.length,
        pendingProposal: thread.pendingProposal !== null,
        pendingCommandCount: fitted.pendingCommands.length,
        omittedPendingCommandCount: (thread.pendingProposal?.commands.length ?? 0) - fitted.pendingCommands.length,
        lastCommit: thread.lastCommit !== null,
        committedCommandCount: fitted.committedCommands.length,
        omittedCommittedCommandCount: (thread.lastCommit?.commands.length ?? 0) - fitted.committedCommands.length,
        measuredDeltaCount: fitted.measuredDeltas.length,
        omittedMeasuredDeltaCount: (thread.lastCommit?.measuredDeltas.length ?? 0) - fitted.measuredDeltas.length,
        bytes,
    };
}

/**
 * The `thread_context` section for one message profile, within that profile's byte cap. The cap
 * is filled in the order a refinement needs: the newest earlier request, then the pending
 * proposal's commands, then the last commit's commands and measured deltas, then the earlier
 * requests from newest back. An entry that does not fit is left out whole and counted; the entries
 * after a command or delta that did not fit are still tried, but requests stop at the first that
 * does not fit, so what survives is always the newest run of turns and the oldest go first. Only
 * the section's ids and counts are always present, and their bounds keep them within either cap.
 */
export function fitThreadContext(thread: ThreadContext, profile: LlmActionMessageProfile): FittedThreadContext {
    const cap = THREAD_CONTEXT_MAX_BYTES[profile];
    let fitted: FittedThread = { requests: [], pendingCommands: [], committedCommands: [], measuredDeltas: [] };
    const tryAdd = (candidate: FittedThread): boolean => {
        if (byteLength(serializeSection(thread, candidate)) > cap) {
            return false;
        }
        fitted = candidate;
        return true;
    };
    const newestFirstRequests = [...thread.requests].reverse();
    const newestRequest = newestFirstRequests[0];
    const requestsFit = newestRequest === undefined || tryAdd({ ...fitted, requests: [newestRequest] });
    for (const command of thread.pendingProposal?.commands ?? []) {
        tryAdd({ ...fitted, pendingCommands: [...fitted.pendingCommands, command] });
    }
    for (const command of thread.lastCommit?.commands ?? []) {
        tryAdd({ ...fitted, committedCommands: [...fitted.committedCommands, command] });
    }
    for (const delta of thread.lastCommit?.measuredDeltas ?? []) {
        tryAdd({ ...fitted, measuredDeltas: [...fitted.measuredDeltas, delta] });
    }
    if (requestsFit) {
        for (const request of newestFirstRequests.slice(1)) {
            if (!tryAdd({ ...fitted, requests: [request, ...fitted.requests] })) {
                break;
            }
        }
    }
    const section = serializeSection(thread, fitted);
    return {
        section,
        evidence: describeFit(thread, fitted, byteLength(section)),
        carriesMeasurement: fitted.measuredDeltas.length > 0,
    };
}
