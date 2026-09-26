import {
    compilePartialCommandBatchAcceptance,
    parseVersionedCommandBatchEnvelope,
    previewVersionedCommandBatchEnvelope,
    refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';

import { type AgentRunPhase } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { type SemanticCommandListMatchSelectorRecord } from '../models/SemanticCommandList';
import { appendChatMessage, updateChatMessage } from '../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    getPendingActionConfirmation,
    supersedePendingActionConfirmation,
} from '../stores/pendingActionConfirmationStore';

import { pendingActionResourceSettlement } from './agentRequestOrchestration/pendingActionResourceSettlement';
import { persistPromptActionConfirmation } from './agentRequestOrchestration/persistPromptActionConfirmation';
import { revalidateApprovedMatchSelectors } from './agentRequestOrchestration/revalidateApprovedMatchSelectors';
import { agentRunLifecycle } from './agentRunLifecycle';
import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';

type ReproposePendingChatActionsInput = {
    confirmationId: string;
    selectedIntentGroupIds?: readonly string[];
};

export type ReproposePendingChatActionsResult =
    | {
          status: 'reproposed';
          confirmationId: string;
          supersededConfirmationId: string;
          includedIntentGroupIds: string[];
      }
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'rejected'; reason: string }
    | { status: 'conflicted'; reason: string };

type WorkingBatch = NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;

const SUPERSEDED_REASON = 'Superseded by a re-preview against the current project.';
const SUPERSEDED_MESSAGE = 'This proposal was replaced by a re-preview against the current project.';
const REPROPOSED_CONTENT = 'Re-previewed against the current project.';
const ALREADY_REPLACED_REASON = 'A newer proposal already replaced this one.';
const MISSING_RUN_REASON = 'The run this proposal belongs to is no longer recorded.';
const PREPARED_STEM_RESOURCES_REASON =
    'This proposal holds prepared stem resources. Cancel it and ask again to re-prepare them.';

const TERMINAL_RUN_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A prepared stem lease is registered for exactly the confirmations whose actions carry stems, and
 * retiring the replaced proposal discards that lease. Its release frees every `audioBufferId` and
 * staged asset lease the replacement, persisted from the same actions, would still reference.
 */
function holdsPreparedStemResources(actions: PendingAppActionConfirmation['actions']): boolean {
    return actions.some((action) => action.type === 'importStemSet' && action.payload.stems.length > 0);
}

/** Only a live proposal on a live run can be replaced; everything else keeps the state it settled into. */
function admitReproposal(
    confirmation: PendingAppActionConfirmation
): Extract<ReproposePendingChatActionsResult, { status: 'not_pending' | 'rejected' }> | null {
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }
    if (confirmation.supersededBy !== null) {
        return { status: 'rejected', reason: ALREADY_REPLACED_REASON };
    }
    const run = agentRunLifecycle.get(confirmation.runId);
    if (!run) {
        return { status: 'rejected', reason: MISSING_RUN_REASON };
    }
    if (TERMINAL_RUN_PHASES.has(run.phase)) {
        return { status: 'rejected', reason: `The run this proposal belongs to is already ${run.phase}.` };
    }
    if (holdsPreparedStemResources(confirmation.actions)) {
        return { status: 'rejected', reason: PREPARED_STEM_RESOURCES_REASON };
    }
    return null;
}

type SubsetSelection =
    | { status: 'selected'; workingBatch: WorkingBatch; includedOriginalCommandIds: readonly string[] }
    | Extract<ReproposePendingChatActionsResult, { status: 'rejected' | 'conflicted' }>;

/**
 * Compile the selected groups and everything they depend on into a standalone batch. The
 * preview mints the selection token partial acceptance requires and is released either way,
 * because a retained preview workspace outlives the decision it was opened for.
 */
function compileSelectedSubset(
    confirmation: PendingAppActionConfirmation,
    envelope: Parameters<typeof previewVersionedCommandBatchEnvelope>[0],
    selectedIntentGroupIds: readonly string[]
): SubsetSelection {
    const preview = previewVersionedCommandBatchEnvelope(envelope);
    if (preview.status === 'conflicted') {
        return { status: 'conflicted', reason: preview.reason };
    }
    if (preview.status === 'no-op') {
        return { status: 'rejected', reason: 'The proposal no longer changes the project.' };
    }
    if (preview.status !== 'previewed') {
        return { status: 'rejected', reason: preview.reason };
    }
    try {
        const compiled = compilePartialCommandBatchAcceptance({
            batchId: crypto.randomUUID(),
            previewSelection: preview.partialAcceptance,
            runId: confirmation.runId,
            selectedIntentGroupIds,
        });
        if (compiled.status === 'rejected') {
            return { status: 'rejected', reason: compiled.reason };
        }
        return {
            status: 'selected',
            workingBatch: { authority: compiled.authority, serialized: compiled.serialized },
            includedOriginalCommandIds: compiled.includedOriginalCommandIds,
        };
    } finally {
        preview.resource.release();
    }
}

/** Rewrites every position to its new index, or returns `null` when any position was dropped. */
function rewriteActionPositions(
    positions: readonly number[],
    newPositionByOriginalIndex: ReadonlyMap<number, number>
): number[] | null {
    const rewritten: number[] = [];
    for (const position of positions) {
        const newPosition = newPositionByOriginalIndex.get(position);
        if (newPosition === undefined) {
            return null;
        }
        rewritten.push(newPosition);
    }
    return rewritten;
}

/**
 * The subset route can drop actions a carried selector's own list item produced: keep a record
 * only when every one of its `actionPositions` survived into the subset, then rewrite those
 * positions to their new indexes in the replacement's `actions`. Coverage is checked against the
 * record's own positions rather than its `stableIds` because a *different* item's kept action can
 * touch the same ids the record resolved to (for example, a `where`-selected command targeting the
 * same track a `match` selector also resolved) — comparing ids alone would carry the record forward
 * for a subset that dropped every action the record's item produced.
 */
function filterCarriedMatchSelectorPredicates(
    matchSelectorPredicates: readonly SemanticCommandListMatchSelectorRecord[] | undefined,
    includedActionIndexes: readonly number[]
): SemanticCommandListMatchSelectorRecord[] | undefined {
    if (!matchSelectorPredicates) {
        return undefined;
    }
    const newPositionByOriginalIndex = new Map(
        includedActionIndexes.map((originalIndex, newIndex) => [originalIndex, newIndex])
    );
    const kept = matchSelectorPredicates.flatMap((record) => {
        const actionPositions = rewriteActionPositions(record.actionPositions, newPositionByOriginalIndex);
        return actionPositions === null ? [] : [{ ...record, actionPositions }];
    });
    return kept.length === 0 ? undefined : kept;
}

type CarriedSelectionResult =
    | {
          status: 'carried';
          affectedIds: readonly string[];
          matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[] | undefined;
      }
    | Extract<ReproposePendingChatActionsResult, { status: 'rejected' }>;

/**
 * Narrow the confirmation's carried affected ids and `match` selector records to the subset
 * route's included actions, then replay whatever selectors survive against the live project
 * before the caller persists anything derived from them.
 */
function resolveCarriedSelection(
    confirmation: PendingAppActionConfirmation,
    actions: PendingAppActionConfirmation['actions'],
    includedActionIndexes: readonly number[],
    selectsSubset: boolean
): CarriedSelectionResult {
    let affectedIds = confirmation.affectedIds;
    let matchSelectorPredicates = confirmation.approvalSnapshot.matchSelectorPredicates;
    if (selectsSubset) {
        affectedIds = [...new Set(actions.flatMap((action) => getPlannedActionAffectedIds(action)))];
        matchSelectorPredicates = filterCarriedMatchSelectorPredicates(matchSelectorPredicates, includedActionIndexes);
    }
    const revalidation = revalidateApprovedMatchSelectors(matchSelectorPredicates ?? []);
    if (revalidation.status === 'invalidated') {
        return { status: 'rejected', reason: revalidation.detail };
    }
    return { status: 'carried', affectedIds, matchSelectorPredicates };
}

/** The actions and labels the included commands came from, by their position in the replaced proposal. */
function selectIncludedPlan(
    confirmation: PendingAppActionConfirmation,
    originalCommandIds: readonly string[],
    includedOriginalCommandIds: readonly string[]
) {
    // `compilePendingActionCommandEnvelopes` emits one command per planned action in order, so
    // an original command's position is its action's position in the proposal being replaced.
    const includedCommandIds = new Set(includedOriginalCommandIds);
    const includedActionIndexes = originalCommandIds.flatMap((commandId, index) =>
        includedCommandIds.has(commandId) ? [index] : []
    );
    return {
        includedActionIndexes,
        actions: includedActionIndexes.flatMap((index) => {
            const action = confirmation.actions[index];
            return action ? [action] : [];
        }),
        actionLabels: includedActionIndexes.flatMap((index) => {
            const label = confirmation.actionLabels[index];
            return label === undefined ? [] : [label];
        }),
    };
}

/**
 * Re-anchor a batch to the live project: refresh it onto the current revision, mint the exact
 * risk approval binding that revision earns, and read back the envelope the caller records.
 */
function rebindToCurrentProject(workingBatch: WorkingBatch) {
    const refreshed = refreshVersionedCommandBatchForApproval(workingBatch);
    if (refreshed.status === 'conflicted') {
        return { status: 'conflicted' as const, reason: refreshed.reason };
    }
    if (refreshed.status === 'rejected') {
        return { status: 'rejected' as const, reason: refreshed.reason };
    }
    let approval: ReturnType<typeof compileAgentRiskApproval>;
    try {
        approval = compileAgentRiskApproval({ commandBatch: refreshed.commandBatch, requireExplicitApproval: true });
    } catch (error) {
        return { status: 'rejected' as const, reason: failureReason(error) };
    }
    const parsed = parseVersionedCommandBatchEnvelope(
        refreshed.commandBatch.serialized,
        refreshed.commandBatch.authority
    );
    if (parsed.status === 'invalid') {
        return { status: 'rejected' as const, reason: parsed.reason };
    }
    return { status: 'rebound' as const, approval, parsed, refreshed };
}

/** Retire the replaced proposal: invalidate it, discard its prepared resources, and say so in chat. */
async function retireSupersededConfirmation(
    confirmation: PendingAppActionConfirmation,
    reproposedConfirmationId: string
): Promise<void> {
    supersedePendingActionConfirmation({
        confirmationId: confirmation.id,
        supersededBy: reproposedConfirmationId,
        reason: SUPERSEDED_REASON,
    });
    await pendingActionResourceSettlement.settleBestEffort({
        confirmationId: confirmation.id,
        disposition: 'discard',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: SUPERSEDED_REASON,
        content: SUPERSEDED_MESSAGE,
    });
}

/** The fresh batch awaits approval; the batch it replaced is cancelled unless it is the same batch. */
function recordReplacementBatch(
    runId: string,
    replacedBatchId: string,
    envelope: Parameters<typeof previewVersionedCommandBatchEnvelope>[0]
): void {
    agentRunLifecycle.recordBatch({
        runId,
        batch: {
            batchId: envelope.batchId,
            commandIds: envelope.commands.map((command) => command.commandId),
            status: 'waiting-for-approval',
            receiptIdentity: null,
        },
    });
    if (envelope.batchId !== replacedBatchId) {
        agentRunLifecycle.updateBatchStatus({ runId, batchId: replacedBatchId, status: 'cancelled' });
    }
}

/**
 * Replace a stale or partially accepted proposal with a fresh one bound to the current
 * revision. The run stays alive: the superseded proposal is invalidated and its prepared
 * resources discarded, but nothing cancels the run the musician is still steering.
 */
export async function reproposePendingChatActions(
    input: ReproposePendingChatActionsInput
): Promise<ReproposePendingChatActionsResult> {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    const refusal = admitReproposal(confirmation);
    if (refusal) {
        return refusal;
    }
    const { agentApproval, commandBatch } = confirmation.approvalSnapshot;
    if (!commandBatch) {
        return { status: 'rejected', reason: 'The confirmation has no approved command batch to re-preview.' };
    }
    if (!agentApproval) {
        return { status: 'rejected', reason: 'The confirmation has no exact risk approval binding.' };
    }
    const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedOriginal.status === 'invalid') {
        return { status: 'rejected', reason: parsedOriginal.reason };
    }
    const originalCommandIds = parsedOriginal.envelope.commands.map((command) => command.commandId);
    const selectsSubset =
        input.selectedIntentGroupIds !== undefined && input.selectedIntentGroupIds.length !== originalCommandIds.length;

    let workingBatch: WorkingBatch = commandBatch;
    let includedOriginalCommandIds: readonly string[] = originalCommandIds;
    if (selectsSubset) {
        const selected = compileSelectedSubset(
            confirmation,
            parsedOriginal.envelope,
            input.selectedIntentGroupIds ?? []
        );
        if (selected.status !== 'selected') {
            return selected;
        }
        workingBatch = selected.workingBatch;
        includedOriginalCommandIds = selected.includedOriginalCommandIds;
    }

    const rebound = rebindToCurrentProject(workingBatch);
    if (rebound.status !== 'rebound') {
        return rebound;
    }
    const { approval, parsed: parsedRefreshed, refreshed } = rebound;

    const { actions, actionLabels, includedActionIndexes } = selectIncludedPlan(
        confirmation,
        originalCommandIds,
        includedOriginalCommandIds
    );
    const carriedSelection = resolveCarriedSelection(confirmation, actions, includedActionIndexes, selectsSubset);
    if (carriedSelection.status === 'rejected') {
        return carriedSelection;
    }
    const { affectedIds, matchSelectorPredicates: carriedMatchSelectorPredicates } = carriedSelection;

    const assistantMessageId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: assistantMessageId,
        role: 'assistant',
        content: REPROPOSED_CONTENT,
        timestamp: Date.now(),
        isCommandAction: true,
    });
    const reproposedConfirmationId = persistPromptActionConfirmation({
        runId: confirmation.runId,
        prompt: confirmation.prompt,
        assistantMessageId,
        actions,
        actionLabels,
        commandEnvelopes: refreshed.commandEnvelopes,
        commandBatch: refreshed.commandBatch,
        agentApproval: approval,
        affectedIds: [...affectedIds],
        protectedUnchanged: confirmation.protectedUnchanged,
        // Rebinding here (`rebindToCurrentProject`) reuses the original resolved target ids embedded
        // in the working batch's commands rather than re-resolving any `match` selector, so this
        // re-preview is itself a point where a selector could go stale unnoticed; `revalidateApprovedMatchSelectors`
        // above already replayed the filtered set (subset-covered only) against the live project and
        // rejected before persisting anything if any selector no longer resolves the same targets. What
        // survives that check is carried forward so a later `resolveConfirmationAdmission`
        // changed-revision re-resolution keeps guarding a reproposed confirmation the same way it
        // guards a first-proposed one.
        matchSelectorPredicates: carriedMatchSelectorPredicates,
        executionMode: confirmation.executionMode,
        group: {
            groupId: confirmation.groupId ?? parsedRefreshed.envelope.batchId,
            groupLabel: confirmation.groupLabel ?? confirmation.prompt,
        },
        projectRevision: refreshed.currentRevision,
        parsedCommandBatch: parsedRefreshed,
        content: REPROPOSED_CONTENT,
        supersedes: confirmation.id,
    });
    if (!reproposedConfirmationId) {
        return { status: 'rejected', reason: 'Prepared action resources exceed the live confirmation limit.' };
    }

    await retireSupersededConfirmation(confirmation, reproposedConfirmationId);
    recordReplacementBatch(confirmation.runId, parsedOriginal.envelope.batchId, parsedRefreshed.envelope);

    return {
        status: 'reproposed',
        confirmationId: reproposedConfirmationId,
        supersededConfirmationId: confirmation.id,
        includedIntentGroupIds: [...includedOriginalCommandIds],
    };
}
