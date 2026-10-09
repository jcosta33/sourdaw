import { type AgentRunReceipt } from '../models/AgentRun';
import { type ChatActionConfirmationStatus, type ChatMessage } from '../models/Chat';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    THREAD_CONTEXT_MAX_TURNS,
    type ThreadCommand,
    type ThreadContext,
    type ThreadMeasuredDelta,
} from '../models/ThreadContext';

type ThreadConfirmation = {
    runId: string;
    assistantMessageId: string;
    status: ChatActionConfirmationStatus;
    supersededBy: string | null;
    approvalSnapshot: {
        actions: ReadonlyArray<{ type: string; payload?: unknown }>;
        actionLabels: readonly string[];
        measuredPreview?: MeasuredPreview;
    };
};

type ThreadRun = { runId: string; receipts: readonly AgentRunReceipt[] };

type ThreadActionGroup = {
    groupId: string;
    reverted: boolean;
    actions: ReadonlyArray<{ actionType: string; label: string }>;
};

export type ThreadContextSources = {
    messages: readonly ChatMessage[];
    confirmations: readonly ThreadConfirmation[];
    runs: readonly ThreadRun[];
    actionGroups: readonly ThreadActionGroup[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The thread's messages from the oldest of its last `THREAD_CONTEXT_MAX_TURNS` requests onward. */
function readThreadWindow(messages: readonly ChatMessage[]): readonly ChatMessage[] {
    const requestIndexes = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
    if (requestIndexes.length <= THREAD_CONTEXT_MAX_TURNS) {
        return messages;
    }
    return messages.slice(requestIndexes[requestIndexes.length - THREAD_CONTEXT_MAX_TURNS]);
}

function commandsOfSnapshot(snapshot: ThreadConfirmation['approvalSnapshot']): ThreadCommand[] {
    return snapshot.actions.map((action, index) => {
        const command: ThreadCommand = { name: action.type, label: snapshot.actionLabels[index] ?? action.type };
        if (isRecord(action.payload)) {
            command.arguments = action.payload;
        }
        return command;
    });
}

function deltasOfPreview(preview: MeasuredPreview | undefined): ThreadMeasuredDelta[] {
    const deltas: ThreadMeasuredDelta[] = [];
    for (const target of preview?.targets ?? []) {
        for (const [metric, delta] of Object.entries(target.deltas)) {
            if (delta?.status === 'compared') {
                deltas.push({ targetId: target.targetId, metric, delta: delta.delta, unit: delta.unit });
            }
        }
    }
    return deltas;
}

function commandsOfHistory(groups: readonly ThreadActionGroup[]): ThreadCommand[] {
    return groups.flatMap((group) => group.actions.map((action) => ({ name: action.actionType, label: action.label })));
}

/**
 * The commit a thread message reports, if it reports one: a confirmation that executed there, or
 * the run the message was written for. Either counts only once its run holds a receipt. A confirmed
 * commit states its commands from the approval it executed; a direct commit states them from the
 * history entry its receipt's revert group recorded.
 */
function readCommitAt(message: ChatMessage, sources: ThreadContextSources): ThreadContext['lastCommit'] {
    const confirmation = sources.confirmations.find(
        (candidate) => candidate.assistantMessageId === message.id && candidate.status === 'executed'
    );
    const runId = confirmation?.runId ?? message.agentRunId;
    const run = runId === undefined ? undefined : sources.runs.find((candidate) => candidate.runId === runId);
    if (run === undefined || run.receipts.length === 0) {
        return null;
    }
    const groups = run.receipts.flatMap((receipt) =>
        sources.actionGroups.filter(
            (group) => receipt.revertGroupId !== null && group.groupId === receipt.revertGroupId
        )
    );
    return {
        runId: run.runId,
        receiptIds: run.receipts.map((receipt) => receipt.receiptIdentity),
        reverted: groups.length > 0 && groups.every((group) => group.reverted),
        commands: confirmation ? commandsOfSnapshot(confirmation.approvalSnapshot) : commandsOfHistory(groups),
        measuredDeltas: deltasOfPreview(confirmation?.approvalSnapshot.measuredPreview),
    };
}

function readPendingProposal(
    window: readonly ChatMessage[],
    sources: ThreadContextSources
): ThreadContext['pendingProposal'] {
    for (const message of [...window].reverse()) {
        const pending = sources.confirmations.find(
            (candidate) =>
                candidate.assistantMessageId === message.id &&
                candidate.status === 'proposed' &&
                candidate.supersededBy === null
        );
        if (pending !== undefined) {
            return { runId: pending.runId, commands: commandsOfSnapshot(pending.approvalSnapshot) };
        }
    }
    return null;
}

function readLastCommit(window: readonly ChatMessage[], sources: ThreadContextSources): ThreadContext['lastCommit'] {
    for (const message of [...window].reverse()) {
        const commit = readCommitAt(message, sources);
        if (commit !== null) {
            return commit;
        }
    }
    return null;
}

/**
 * What the chat thread holds for the request about to be planned, read from the thread's messages,
 * the pending confirmations, the agent runs and the AI action history. The request being planned is
 * not yet in the thread, so every request returned is an earlier one. A thread with no pending
 * proposal and no commit inside its window has no state, and returns `null`.
 */
export function buildThreadContext(sources: ThreadContextSources): ThreadContext | null {
    const window = readThreadWindow(sources.messages);
    const pendingProposal = readPendingProposal(window, sources);
    const lastCommit = readLastCommit(window, sources);
    if (pendingProposal === null && lastCommit === null) {
        return null;
    }
    return {
        requests: window.filter((message) => message.role === 'user').map((message) => message.content),
        pendingProposal,
        lastCommit,
    };
}
