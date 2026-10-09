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
    /** The batch's revert group, which is also its batch id: the id its receipt's work carries. */
    groupId?: string;
    approvalSnapshot: {
        actions: ReadonlyArray<{ type: string; payload?: unknown }>;
        actionLabels: readonly string[];
        measuredPreview?: MeasuredPreview;
        commandBatch?: { authority: { projectId: string } };
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
    /** The open project's identity; a proposal or commit of any other project is not this thread's state. */
    projectId: string;
    /**
     * The revert groups the undo history holds to redo, which an ordinary undo moved there. A group
     * the history does not hold at all — a singleton batch's ungrouped entries, or entries the size
     * cap pushed out — still stands.
     */
    undoneGroupIds: ReadonlySet<string>;
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

function isOpenProjectConfirmation(confirmation: ThreadConfirmation, sources: ThreadContextSources): boolean {
    return confirmation.approvalSnapshot.commandBatch?.authority.projectId === sources.projectId;
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

/**
 * Whether one batch's change is no longer standing: its history group was reverted, or the undo
 * history holds the group to redo, as after an ordinary undo. Absence from the history never means
 * undone. A batch with no revert group (a runtime-only command) has nothing to undo and stands.
 */
function isUndone(receipt: AgentRunReceipt, sources: ThreadContextSources): boolean {
    const groupId = receipt.revertGroupId;
    if (groupId === null) {
        return false;
    }
    const group = sources.actionGroups.find((candidate) => candidate.groupId === groupId);
    return group?.reverted === true || sources.undoneGroupIds.has(groupId);
}

/** A confirmed batch's commit: the receipt of that batch alone, never another batch of the same run. */
function readConfirmedCommit(
    confirmation: ThreadConfirmation,
    sources: ThreadContextSources
): ThreadContext['lastCommit'] {
    if (!isOpenProjectConfirmation(confirmation, sources) || confirmation.groupId === undefined) {
        return null;
    }
    const run = sources.runs.find((candidate) => candidate.runId === confirmation.runId);
    const receipt = run?.receipts.find((candidate) => candidate.workId === confirmation.groupId);
    if (receipt === undefined) {
        return null;
    }
    return {
        runId: confirmation.runId,
        receiptIds: [receipt.receiptIdentity],
        reverted: isUndone(receipt, sources),
        commands: commandsOfSnapshot(confirmation.approvalSnapshot),
        measuredDeltas: deltasOfPreview(confirmation.approvalSnapshot.measuredPreview),
    };
}

/**
 * A direct commit's batch: the run's receipt no confirmation of the run claims, since every later
 * batch of a run is proposed and receipted through its own confirmation. Its commands are the ones
 * the history recorded under its revert group.
 */
function readDirectCommit(message: ChatMessage, sources: ThreadContextSources): ThreadContext['lastCommit'] {
    if (message.agentRunId === undefined || message.projectId !== sources.projectId) {
        return null;
    }
    const runId = message.agentRunId;
    const confirmedBatchIds = new Set(
        sources.confirmations.flatMap((candidate) =>
            candidate.runId === runId && candidate.groupId !== undefined ? [candidate.groupId] : []
        )
    );
    const run = sources.runs.find((candidate) => candidate.runId === runId);
    const receipt = run?.receipts.find((candidate) => !confirmedBatchIds.has(candidate.workId));
    if (receipt === undefined) {
        return null;
    }
    const group = sources.actionGroups.find((candidate) => candidate.groupId === receipt.revertGroupId);
    return {
        runId,
        receiptIds: [receipt.receiptIdentity],
        reverted: isUndone(receipt, sources),
        commands: (group?.actions ?? []).map((action) => ({ name: action.actionType, label: action.label })),
        measuredDeltas: [],
    };
}

/**
 * The commit a thread message reports, if it reports one. A message that carries a confirmation
 * reports a commit only when that confirmation executed; a proposed, cancelled or superseded one
 * reports none, whatever receipts its run holds from other batches. A message without one reports
 * the direct commit of the run it was written for.
 */
function readCommitAt(message: ChatMessage, sources: ThreadContextSources): ThreadContext['lastCommit'] {
    const confirmations = sources.confirmations.filter((candidate) => candidate.assistantMessageId === message.id);
    if (confirmations.length === 0) {
        return readDirectCommit(message, sources);
    }
    const executed = confirmations.find((candidate) => candidate.status === 'executed');
    if (executed === undefined) {
        return null;
    }
    return readConfirmedCommit(executed, sources);
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
                candidate.supersededBy === null &&
                isOpenProjectConfirmation(candidate, sources)
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
 * the pending confirmations, the agent runs, the AI action history and the undo history, for the
 * open project only. The request being planned is not yet in the thread, so every request returned
 * is an earlier one. A thread with no pending proposal and no commit inside its window has no
 * state, and returns `null`.
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
