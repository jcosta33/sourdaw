import { type AgentRunReceipt } from '../models/AgentRun';
import { type ChatActionConfirmationStatus, type ChatMessage } from '../models/Chat';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    THREAD_CONTEXT_MAX_TURNS,
    type ThreadCommand,
    type ThreadCommitStanding,
    type ThreadContext,
    type ThreadMeasuredDelta,
} from '../models/ThreadContext';

type ThreadConfirmation = {
    runId: string;
    assistantMessageId: string;
    status: ChatActionConfirmationStatus;
    supersededBy: string | null;
    /**
     * The id of the command batch the confirmation records, read from its envelope: the id that
     * batch's receipt work and revert group carry once it commits. Never the confirmation's own
     * group id, which a re-proposed subset keeps from the proposal it replaced.
     */
    batchId: string | null;
    /** What each executed action changed: project state, or only the runtime (transport and the like). */
    executedActions: ReadonlyArray<{ executionKind: 'project' | 'runtime' }>;
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
    /** The revert groups whose entries the undo history holds applied, in `past`. */
    pastGroupIds: ReadonlySet<string>;
    /** The revert groups whose entries the undo history holds to redo, in `future`. */
    futureGroupIds: ReadonlySet<string>;
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
 * Whether one batch's change is still in the project, read from the undo history alone: its
 * group in `past` only means standing, in `future` only means undone. A panel revert moves the
 * entries to `future` like an undo does, so its flag adds nothing, and the flag is never cleared
 * by a redo. Everything else is unknown: a group split across both (a partial undo or revert), a
 * group in neither (a later edit emptied `future`, the size cap or a cleared history dropped
 * `past`), and a batch with no revert group, whose entries the history never holds by group.
 */
function readStanding(receipt: AgentRunReceipt, sources: ThreadContextSources): ThreadCommitStanding {
    const groupId = receipt.revertGroupId;
    if (groupId === null) {
        return 'unknown';
    }
    const inPast = sources.pastGroupIds.has(groupId);
    const inFuture = sources.futureGroupIds.has(groupId);
    if (inPast && !inFuture) {
        return 'standing';
    }
    if (inFuture && !inPast) {
        return 'undone';
    }
    return 'unknown';
}

/**
 * Whether a confirmed batch only drove the runtime. Command runs a runtime action (play, stop, seek)
 * alone in its batch, so a batch whose executed actions are all runtime changed no project state.
 */
function isRuntimeOnly(confirmation: ThreadConfirmation): boolean {
    return (
        confirmation.executedActions.length > 0 &&
        confirmation.executedActions.every((action) => action.executionKind === 'runtime')
    );
}

/**
 * A confirmed batch's commit: the run's receipt for the very batch the confirmation records,
 * whatever status the confirmation settled in, since a batch that committed with effects still
 * pending settles as `failed` yet its change is in the project. Without that receipt the batch
 * committed nothing, and a runtime-only batch is receipted but changed no project state, so
 * neither is a commit and the thread reads on to an earlier one.
 */
function readConfirmedCommit(
    confirmation: ThreadConfirmation,
    sources: ThreadContextSources
): ThreadContext['lastCommit'] {
    if (
        !isOpenProjectConfirmation(confirmation, sources) ||
        confirmation.batchId === null ||
        isRuntimeOnly(confirmation)
    ) {
        return null;
    }
    const run = sources.runs.find((candidate) => candidate.runId === confirmation.runId);
    const receipt = run?.receipts.find((candidate) => candidate.workId === confirmation.batchId);
    if (receipt === undefined) {
        return null;
    }
    return {
        runId: confirmation.runId,
        receiptIds: [receipt.receiptIdentity],
        standing: readStanding(receipt, sources),
        commands: commandsOfSnapshot(confirmation.approvalSnapshot),
        measuredDeltas: deltasOfPreview(confirmation.approvalSnapshot.measuredPreview),
    };
}

/**
 * A direct commit's batch: the run's receipt for the very batch the message was stamped with once
 * that batch committed a project change. A runtime-only batch stamps no batch, so its message
 * reports nothing and the thread reads on to an earlier commit. A run can commit several batches
 * directly, each from its own message, so no other receipt of the run stands in for one. Its
 * commands are the ones the history recorded under its revert group.
 */
function readDirectCommit(message: ChatMessage, sources: ThreadContextSources): ThreadContext['lastCommit'] {
    const { agentRunId: runId, agentBatchId: batchId } = message;
    if (runId === undefined || batchId === undefined || message.projectId !== sources.projectId) {
        return null;
    }
    const run = sources.runs.find((candidate) => candidate.runId === runId);
    const receipt = run?.receipts.find((candidate) => candidate.workId === batchId);
    if (receipt === undefined) {
        return null;
    }
    const group = sources.actionGroups.find((candidate) => candidate.groupId === receipt.revertGroupId);
    return {
        runId,
        receiptIds: [receipt.receiptIdentity],
        standing: readStanding(receipt, sources),
        commands: (group?.actions ?? []).map((action) => ({ name: action.actionType, label: action.label })),
        measuredDeltas: [],
    };
}

/**
 * The commit a thread message reports, if it reports one. A message that carries confirmations
 * reports the batch of the one whose receipt its run holds; with no such receipt it reports none,
 * whatever receipts the run holds for other batches. A message without one reports the batch it
 * committed directly, if it was stamped with one.
 */
function readCommitAt(message: ChatMessage, sources: ThreadContextSources): ThreadContext['lastCommit'] {
    const confirmations = sources.confirmations.filter((candidate) => candidate.assistantMessageId === message.id);
    if (confirmations.length === 0) {
        return readDirectCommit(message, sources);
    }
    for (const confirmation of confirmations) {
        const commit = readConfirmedCommit(confirmation, sources);
        if (commit !== null) {
            return commit;
        }
    }
    return null;
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
