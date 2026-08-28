import { logger } from '#/infra/logger/appLogger';
import {
    getAgentSectionRenderArtifacts,
    rebindAgentProjectSectionArtifactRevisions,
} from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandBatchEnvelope,
    parseVersionedCommandEnvelope,
    refreshVersionedCommandBatchForApproval,
    type createVerifiedBatchReceipt,
} from '#/modules/Command/useCases';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    captureUnownedProjectMutations,
} from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory, type AgentRunErrorRemediation, type AgentRunWorkLease } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { chatStore, setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    commitPendingActionResourceLease,
    getPendingActionConfirmation,
    preparePendingActionResourceLeaseForCommit,
    protectPendingActionResourceLease,
    recordPendingActionExecution,
    refreshPendingActionConfirmationApproval,
    settlePendingActionResourceLeaseBestEffort,
    type PendingActionExecution,
    type PendingAppActionConfirmation,
    updatePendingActionFollowUp,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { admitCommittedSectionRenderRetry } from './agentRequestOrchestration/admitCommittedSectionRenderRetry';
import { executeCommittedSectionRenderRetry } from './agentRequestOrchestration/executeCommittedSectionRenderRetry';
import { formatSectionRenderReviewSummary } from './agentRequestOrchestration/formatSectionRenderReviewSummary';
import { projectSectionRenderConfirmation } from './agentRequestOrchestration/projectSectionRenderConfirmation';
import { requireSectionRenderManualRepair } from './agentRequestOrchestration/requireSectionRenderManualRepair';
import {
    AGENT_RUN_PERSISTENCE_WARNING,
    AGENT_RUN_STALE_COMPLETION_WARNING,
    settleAgentRunWorkLeaseSafely,
} from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget, type AgentWorkBudgetEstimate } from './agentWorkBudget';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { notifyAiChange } from './notifyAiChange';
import { prepareAgentRunPendingEffectContinuation } from './prepareAgentRunPendingEffectContinuation';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type ConfirmedBatchResult = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
type PendingEffect = CommandVerifiedBatchReceipt['pendingEffects'][number];
type CommittedEffectFailureResult = {
    status: 'failed';
    durableCommit: true;
    reason: string;
    effects: PendingEffect[];
    continuation: {
        authority: 'authoritative-collaboration-host';
        idempotency: 'project-checkpoint';
        kind: 'reconcile-exact-batch' | 'manual-repair';
    };
};

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | CommittedEffectFailureResult
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | {
          status: 'reapproval_required';
          divergence: ApprovalDivergence;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

const RENDER_RETRY_PROOF_MISMATCH_REASON =
    'The retained render retry proof no longer matches the committed project batch.';

const COMPLETED_BATCH_STATUSES = new Set([
    'committed',
    'committed-with-warning',
    'executed',
    'executed-with-warning',
    'no-op',
]);

function getTrackedLeaseSettlementContract(batchResult: ConfirmedBatchResult): {
    terminalState: 'completed' | 'cancelled' | 'failed';
    evidence: 'none' | 'verified-command-receipt';
} {
    const outcome =
        batchResult.status === 'idempotent-replay'
            ? getVerifiedBatchReplayDisposition(batchResult.receipt).status
            : batchResult.status;
    let terminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
    if (outcome === 'cancelled') {
        terminalState = 'cancelled';
    } else if (COMPLETED_BATCH_STATUSES.has(outcome)) {
        terminalState = 'completed';
    }
    const evidence =
        batchResult.status === 'idempotent-replay' ||
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'executed' ||
        batchResult.status === 'executed-with-warning'
            ? 'verified-command-receipt'
            : 'none';
    return { terminalState, evidence };
}

async function settlePendingActionResourcesBestEffort(input: {
    confirmationId: string;
    disposition: 'discard' | 'retain' | 'transfer';
}): Promise<void> {
    await settlePendingActionResourceLeaseBestEffort(input);
}

async function retainCommittedPendingActionResources(confirmationId: string): Promise<void> {
    try {
        await commitPendingActionResourceLease(confirmationId);
    } catch (error) {
        logger.error(new Error('Committed resource recovery could not be made executable', { cause: error }));
        return;
    }
    await settlePendingActionResourcesBestEffort({ confirmationId, disposition: 'transfer' });
}

function createCommittedEffectFailureResult(
    receipt: CommandVerifiedBatchReceipt,
    reason = receipt.warnings[0] ?? receipt.modelSummary
): CommittedEffectFailureResult {
    return {
        status: 'failed',
        durableCommit: true,
        reason,
        effects: [...receipt.pendingEffects],
        continuation: {
            authority: 'authoritative-collaboration-host',
            idempotency: 'project-checkpoint',
            kind: receipt.pendingEffects.some(({ remediation }) => remediation === 'manual-repair')
                ? 'manual-repair'
                : 'reconcile-exact-batch',
        },
    };
}

function getVerifiedReceiptIdentity(receipt: CommandVerifiedBatchReceipt): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function updateTrackedAgentRun(confirmation: PendingAppActionConfirmation, update: () => void): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        update();
        return null;
    } catch (error) {
        logger.error(new Error('Agent run lifecycle update failed', { cause: error }));
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function recordTrackedAgentRunFailure(
    confirmation: PendingAppActionConfirmation,
    input: {
        category: AgentRunErrorCategory;
        retriable: boolean;
        workId?: string;
        receiptIdentity?: string;
        compensation?: AgentRunErrorRemediation['compensation'];
        knownDomain?: boolean;
    }
): void {
    const parsedBatch = confirmation.approvalSnapshot.commandBatch
        ? parseVersionedCommandBatchEnvelope(
              confirmation.approvalSnapshot.commandBatch.serialized,
              confirmation.approvalSnapshot.commandBatch.authority
          )
        : null;
    const commandIds =
        parsedBatch?.status === 'valid' ? parsedBatch.envelope.commands.map((command) => command.commandId) : [];
    const batchWorkId = parsedBatch?.status === 'valid' ? parsedBatch.envelope.batchId : undefined;
    const workIds: string[] = [];
    if (input.workId) {
        workIds.push(input.workId);
    } else if (batchWorkId) {
        workIds.push(batchWorkId);
    }
    updateTrackedAgentRun(confirmation, () => {
        agentRunLifecycle.recordError({
            runId: confirmation.runId,
            error: normalizeAgentFailure({
                category: input.category,
                source: 'command-execution',
                related: {
                    targetIds: confirmation.affectedIds,
                    commandIds,
                    workIds,
                    receiptIdentities: input.receiptIdentity ? [input.receiptIdentity] : [],
                },
                retry: input.retriable ? 'owner-proven-idempotent' : 'never',
                ...(input.compensation ? { compensation: input.compensation } : {}),
                knownDomain: input.knownDomain ?? true,
            }),
            terminal: true,
        });
    });
}

function recordTrackedAgentRunReceipt(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt,
    input?: { revertGroupId?: string; completesRun?: boolean; committedRevision?: string }
): { warning: string | null; effectsPending: boolean } {
    let effectsPending = false;
    const warning = updateTrackedAgentRun(confirmation, () => {
        const recorded = recordAgentRunReceiptSaga({
            runId: confirmation.runId,
            receipt,
            actions: confirmation.actions,
            ...(confirmation.approvalSnapshot.commandBatch
                ? { commandBatch: confirmation.approvalSnapshot.commandBatch }
                : {}),
            ...(input?.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            ...(input?.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
            committedRevision: input?.committedRevision ?? captureProjectRevision(),
        });
        effectsPending = recorded.effectsPending;
    });
    return { warning, effectsPending };
}

async function settleVerifiedBatchReplay(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt,
    recoveredExternalEffects = false,
    leaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = { accepted: true, warning: null }
): Promise<ConfirmPendingChatActionsResult> {
    if (receipt.outcome === 'partially-committed' && receipt.pendingEffects.length > 0) {
        const receiptPersistenceWarning = recordTrackedAgentRunReceipt(confirmation, receipt, {
            ...(confirmation.groupId ? { revertGroupId: confirmation.groupId } : {}),
            completesRun: false,
        });
        const reason = receipt.warnings[0] ?? receipt.modelSummary;
        const persistenceWarning = receiptPersistenceWarning.warning ?? leaseSettlement.warning;
        await retainCommittedPendingActionResources(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: [reason, persistenceWarning].filter(Boolean).join(' '),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: [reason, persistenceWarning].filter(Boolean).join(' '),
            content: `The project change is durably committed, but at least one external effect remains pending: ${reason}. Use the retained reconciliation action on the authoritative collaboration host, or follow the retained manual-repair guidance; the project mutation will not replay.${persistenceWarning ? ` ${persistenceWarning}` : ''}`,
        });
        return createCommittedEffectFailureResult(receipt, reason);
    }
    const replay = getVerifiedBatchReplayDisposition(receipt);
    if (replay.status === 'committed' || replay.status === 'executed') {
        const receiptPersistenceWarning = recordTrackedAgentRunReceipt(confirmation, receipt, {
            ...(replay.status === 'committed' && confirmation.groupId ? { revertGroupId: confirmation.groupId } : {}),
            completesRun: leaseSettlement.accepted,
        });
        const runPersistenceWarning = receiptPersistenceWarning.warning ?? leaseSettlement.warning;
        await retainCommittedPendingActionResources(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            error: replay.warning,
        });
        const effect =
            replay.status === 'committed' ? 'project batch was already committed' : 'runtime batch already executed';
        const warning = replay.warning ? ` The prior receipt also reports: ${replay.warning}` : '';
        const persistenceWarning = runPersistenceWarning ? ` ${runPersistenceWarning}` : '';
        const content = recoveredExternalEffects
            ? `This exact ${effect}. Pending external effects were reconciled successfully and the recovered verified receipt was returned.${warning}${persistenceWarning}`
            : `This exact ${effect}. The prior verified receipt was returned without replaying project or runtime effects.${warning}${persistenceWarning}`;
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: [replay.warning, runPersistenceWarning].filter(Boolean).join(' ') || undefined,
            content: receiptPersistenceWarning.effectsPending
                ? `${content} External render or analysis effects remain pending; this run is not complete.`
                : content,
        });
        return { status: 'executed' };
    }
    if (replay.status === 'no-op') {
        if (!leaseSettlement.accepted) {
            await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
            const warning = leaseSettlement.warning ?? AGENT_RUN_STALE_COMPLETION_WARNING;
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'cancelled',
                error: warning,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'cancelled',
                error: warning,
                content: `The prior verified receipt records a no-op. No project or runtime effects were applied, but the run was already cancelled or replaced. ${warning}`,
            });
            return { status: 'cancelled' };
        }
        updateTrackedAgentRun(confirmation, () => {
            agentRunLifecycle.updateBatchStatus({
                runId: confirmation.runId,
                batchId: receipt.batchId,
                status: 'no-op',
            });
            agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            ...(leaseSettlement.warning ? { error: leaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: leaseSettlement.warning ?? undefined,
            content: [
                'The prior verified receipt records a no-op. No project or runtime effects were applied.',
                leaseSettlement.warning,
            ]
                .filter(Boolean)
                .join(' '),
        });
        return { status: 'executed' };
    }
    if (replay.status === 'cancelled') {
        updateTrackedAgentRun(confirmation, () => {
            agentRunLifecycle.cancel({
                runId: confirmation.runId,
                reason: 'The verified command receipt records cancellation.',
            });
        });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'cancelled',
            ...(leaseSettlement.warning ? { error: leaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'cancelled',
            error: leaseSettlement.warning ?? undefined,
            content: [
                'The prior verified receipt records cancellation before commit. No project changes were applied.',
                leaseSettlement.warning,
            ]
                .filter(Boolean)
                .join(' '),
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
        return { status: 'cancelled' };
    }
    await settlePendingActionResourcesBestEffort({
        confirmationId: confirmation.id,
        disposition: replay.status === 'ambiguous' ? 'retain' : 'discard',
    });
    if (replay.status === 'ambiguous') {
        await recoverPreparedStemImportResources({ runId: confirmation.runId });
    }
    const userVisibleFailure = [replay.reason, leaseSettlement.warning].filter(Boolean).join(' ');
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: userVisibleFailure,
    });
    if (leaseSettlement.accepted) {
        recordTrackedAgentRunFailure(confirmation, {
            category: replay.status === 'ambiguous' ? 'conflict' : 'project',
            retriable: false,
            workId: receipt.batchId,
            receiptIdentity: getVerifiedReceiptIdentity(receipt),
            ...(replay.status === 'ambiguous' ? { compensation: 'manual-repair' as const } : {}),
        });
    }
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: userVisibleFailure,
        content:
            replay.status === 'ambiguous'
                ? `The prior verified receipt records an ambiguous outcome: ${replay.reason}. Do not retry it; inspect the project first.${leaseSettlement.warning ? ` ${leaseSettlement.warning}` : ''}`
                : `The prior verified receipt records that this command batch did not apply successfully: ${replay.reason}${leaseSettlement.warning ? ` ${leaseSettlement.warning}` : ''}`,
    });
    return { status: 'failed', reason: replay.reason };
}

function getApprovalLabelsByCommandId(confirmation: PendingAppActionConfirmation): ReadonlyMap<string, string> {
    const labels = new Map<string, string>();
    for (const [index, serialized] of (confirmation.approvalSnapshot.commandEnvelopes ?? []).entries()) {
        const parsed = parseVersionedCommandEnvelope(serialized);
        const label = confirmation.approvalSnapshot.actionLabels[index];
        if (parsed.status === 'valid' && label !== undefined) {
            labels.set(parsed.envelope.commandId, label);
        }
    }
    return labels;
}

function isConfirmationExecutionAuthorized(isProjectMutationAuthorized: () => boolean, signal: AbortSignal): boolean {
    if (signal.aborted) {
        return false;
    }
    return isProjectMutationAuthorized();
}

function getProtectedAffectedIds(
    actions: readonly PendingAppActionConfirmation['actions'][number][],
    protectedTargets: readonly PendingAppActionConfirmation['protectedUnchanged'][number][]
): string[] {
    const protectedIds = new Set(protectedTargets.map((target) => target.id));
    return [
        ...new Set(
            actions.flatMap((action) => getPlannedActionAffectedIds(action)).filter((id) => protectedIds.has(id))
        ),
    ];
}

function getApprovalPreflightFailure(confirmation: PendingAppActionConfirmation): string | null {
    const approved = confirmation.approvalSnapshot;
    if (!approved.commandBatch) {
        return 'The confirmation has no approved command batch.';
    }
    if (!approved.agentApproval) {
        return 'The command batch has no exact risk approval binding.';
    }
    const validation = validateAgentRiskApproval({
        approval: approved.agentApproval,
        commandBatch: approved.commandBatch,
        currentRevision: captureProjectRevision(),
    });
    if (validation.status === 'invalid') {
        return validation.reason;
    }
    const protectedAffectedIds = getProtectedAffectedIds(confirmation.actions, approved.protectedUnchanged);
    if (protectedAffectedIds.length > 0) {
        return `The executable action batch targets protected IDs: ${protectedAffectedIds.join(', ')}.`;
    }

    const currentApproval = JSON.stringify({
        actions: confirmation.actions,
        actionLabels: confirmation.actionLabels,
        protectedUnchanged: confirmation.protectedUnchanged,
    });
    const immutableApproval = JSON.stringify({
        actions: approved.actions,
        actionLabels: approved.actionLabels,
        protectedUnchanged: approved.protectedUnchanged,
    });
    if (currentApproval !== immutableApproval) {
        return 'The executable action batch no longer matches the approved proposal.';
    }

    const approvedProtectedAffectedIds = getProtectedAffectedIds(approved.actions, approved.protectedUnchanged);
    if (approvedProtectedAffectedIds.length > 0) {
        return `The approved action batch targets protected IDs: ${approvedProtectedAffectedIds.join(', ')}.`;
    }

    return null;
}

function rebindFreshSectionRenderArtifactsToCommittedRevision(
    confirmation: PendingAppActionConfirmation,
    artifactsBeforeExecution: ReturnType<typeof getAgentSectionRenderArtifacts>,
    committedRevision: string
): void {
    const renderAction = confirmation.approvalSnapshot.actions.find(
        (action) => action.type === 'renderProjectSections'
    );
    if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
        return;
    }
    const preexistingJobIds = new Set(artifactsBeforeExecution.map(({ jobId }) => jobId));
    const currentArtifacts = getAgentSectionRenderArtifacts();
    const freshArtifacts = renderAction.payload.jobs.flatMap((job) => {
        if (preexistingJobIds.has(job.jobId)) {
            return [];
        }
        const artifact = currentArtifacts.find(
            (candidate) =>
                candidate.jobId === job.jobId &&
                candidate.sectionId === job.sectionId &&
                candidate.sectionName === job.sectionName &&
                candidate.startBeat === job.startBeat &&
                candidate.endBeat === job.endBeat &&
                candidate.sampleRate === job.sampleRate &&
                candidate.tailSeconds === job.tailSeconds
        );
        return artifact ? [{ job, renderedAt: artifact.renderedAt, sourceRevision: artifact.sourceRevision }] : [];
    });
    // The durable receipt checkpoint advances the CRDT revision after post-commit
    // rendering; only exact artifacts created by this execution may follow it.
    rebindAgentProjectSectionArtifactRevisions({
        artifacts: freshArtifacts,
        sourceRevision: committedRevision,
    });
}

function failCommittedSectionRenderRetryProof(
    confirmation: PendingAppActionConfirmation
): ConfirmPendingChatActionsResult {
    updatePendingActionFollowUp({
        confirmationId: confirmation.id,
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
        status: 'failed',
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        pendingActionFollowUpStatus: 'failed',
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
        content: `The missing section renders were not retried because the retained proof no longer matches the approved batch and recorded commit evidence. Project actions were not replayed. Verify the project state before taking further action.`,
    });
    return { status: 'failed', reason: RENDER_RETRY_PROOF_MISMATCH_REASON };
}

function failUnreadableCommitEvidence(
    confirmation: PendingAppActionConfirmation,
    error: unknown,
    retryRemainsAvailable: boolean
): ConfirmPendingChatActionsResult {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = retryRemainsAvailable
        ? `The durable commit evidence for the retained render retry could not be read: ${detail}. The render retry remains available.`
        : `The durable commit evidence for the confirmed actions could not be read: ${detail}. The proposal remains pending.`;
    updateChatMessage(confirmation.assistantMessageId, {
        error: reason,
        content: retryRemainsAvailable
            ? `The missing section renders were not retried because the durable commit evidence could not be read: ${detail}. Project actions were not replayed and the render retry remains available.`
            : `The confirmed actions were not executed because the durable commit evidence could not be read: ${detail}. Project actions were not replayed; the proposal remains pending.`,
    });
    return { status: 'failed', reason };
}

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    let confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    const wasProposed = confirmation.status === 'proposed';
    const initialRetryAdmission = admitCommittedSectionRenderRetry({
        confirmation,
        phase: 'eligibility',
    });
    const wasRetryEligible = initialRetryAdmission.status === 'requires-proof';
    const shouldInspectDurableReceipt = wasProposed || wasRetryEligible;
    let priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null = null;
    if (approvedCommandBatch && shouldInspectDurableReceipt) {
        try {
            priorVerifiedBatchReceipt = await getVersionedCommandBatchIdempotentReplay({
                authority: approvedCommandBatch.authority,
                serialized: approvedCommandBatch.serialized,
            });
        } catch (error) {
            // Unreadable commit evidence is not absence: never fail the retry
            // proof or re-execute against evidence that could not be read.
            return failUnreadableCommitEvidence(confirmation, error, wasRetryEligible);
        }
        const refreshedConfirmation = getPendingActionConfirmation(input.confirmationId);
        if (!refreshedConfirmation) {
            return { status: 'missing' };
        }
        const refreshedRetryAdmission = admitCommittedSectionRenderRetry({
            confirmation: refreshedConfirmation,
            expectedCommandBatch: approvedCommandBatch,
            phase: 'eligibility',
        });
        const retryAdmissionChanged = wasRetryEligible && refreshedRetryAdmission.status !== 'requires-proof';
        if (
            refreshedRetryAdmission.status === 'stale' ||
            retryAdmissionChanged ||
            (wasProposed && refreshedConfirmation.status !== 'proposed')
        ) {
            return { status: 'not_pending', currentStatus: refreshedConfirmation.status };
        }
        confirmation = refreshedConfirmation;
    }
    if (wasRetryEligible) {
        const retryAdmission = admitCommittedSectionRenderRetry({
            confirmation,
            durableReceipt: priorVerifiedBatchReceipt,
            expectedCommandBatch: approvedCommandBatch,
            phase: 'proof',
        });
        if (retryAdmission.status === 'admitted') {
            const admittedCommandBatch = confirmation.approvalSnapshot.commandBatch;
            if (!admittedCommandBatch) {
                return failCommittedSectionRenderRetryProof(confirmation);
            }
            return executeCommittedSectionRenderRetry({
                confirmation,
                durableReceipt: retryAdmission.durableReceipt,
                commandBatch: admittedCommandBatch,
            });
        }
        if (retryAdmission.status === 'proof-mismatch') {
            return failCommittedSectionRenderRetryProof(confirmation);
        }
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;
    const recoveringPendingEffects =
        priorVerifiedBatchReceipt?.outcome === 'partially-committed' &&
        priorVerifiedBatchReceipt.pendingEffects.length > 0;

    if (!hasPriorVerifiedBatchReceipt && captureProjectRevision() !== confirmation.projectRevision) {
        const commandBatch = confirmation.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            return invalidatePendingConfirmation(confirmation);
        }
        const refreshed = refreshVersionedCommandBatchForApproval({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        if (refreshed.status !== 'ready') {
            if (refreshed.status === 'conflicted') {
                return invalidatePendingConfirmationForDivergence(confirmation, refreshed.divergence);
            }
            return invalidatePendingConfirmation(confirmation);
        }
        const agentApproval = compileAgentRiskApproval({ commandBatch: refreshed.commandBatch });
        const rebound = refreshPendingActionConfirmationApproval({
            agentApproval,
            commandBatch: refreshed.commandBatch,
            commandEnvelopes: refreshed.commandEnvelopes,
            confirmationId: confirmation.id,
            projectRevision: refreshed.currentRevision,
        });
        if (!rebound) {
            return invalidatePendingConfirmation(confirmation);
        }
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `The project changed after the prior approval. Divergence was classified as ${refreshed.divergence.kind}; the unchanged command plan was revalidated and rebound to the current project revision. Review and confirm again:\n\n${rebound.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'reapproval_required', divergence: refreshed.divergence };
    }

    if (chatStore.value?.isGenerating === true) {
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `Another AI command is still running. This proposal remains pending:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'busy' };
    }

    const approvalPreflightFailure = hasPriorVerifiedBatchReceipt ? null : getApprovalPreflightFailure(confirmation);
    if (approvalPreflightFailure) {
        return failApprovalPreflight(confirmation, approvalPreflightFailure, 'authorization');
    }

    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        return failApprovalPreflight(confirmation, 'The confirmation has no approved command batch.', 'authorization');
    }
    let trackedWorkLease: AgentRunWorkLease | null = null;
    let commandBudget: { attemptId: string; estimates: AgentWorkBudgetEstimate[] } | null = null;
    if (agentRunLifecycle.get(confirmation.runId)) {
        const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedCommandBatch.status === 'invalid') {
            return failApprovalPreflight(confirmation, parsedCommandBatch.reason, 'schema');
        }
        const attemptId = `${parsedCommandBatch.envelope.batchId}:1`;
        const budgetReservation = hasPriorVerifiedBatchReceipt
            ? null
            : agentWorkBudget.reserveCommandWork({
                  runId: confirmation.runId,
                  envelope: parsedCommandBatch.envelope,
                  attemptId,
              });
        if (budgetReservation?.status === 'hard-limit-reached') {
            return failApprovalPreflight(
                confirmation,
                `The confirmed command work exceeds the user budget for ${budgetReservation.reason}.`,
                'budget'
            );
        }
        if (!hasPriorVerifiedBatchReceipt) {
            const receiptIdentity = `command:${confirmation.runId}:${parsedCommandBatch.envelope.batchId}`;
            const leaseResult = agentRunWorkLease.claim({
                runId: confirmation.runId,
                workId: parsedCommandBatch.envelope.batchId,
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                receiptIdentity,
                idempotent: true,
                retriable: false,
            });
            if (leaseResult.status !== 'claimed') {
                return failApprovalPreflight(
                    confirmation,
                    `The confirmed command work could not be claimed: ${leaseResult.status}`,
                    'conflict'
                );
            }
            trackedWorkLease = leaseResult.lease;
        }
        if (budgetReservation) {
            commandBudget = { attemptId, estimates: budgetReservation.estimates };
        }
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    updateTrackedAgentRun(confirmation, () => {
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    const group = confirmation.groupId
        ? { groupId: confirmation.groupId, groupLabel: confirmation.groupLabel }
        : generateGroupId(confirmation.prompt);
    const sectionRenderArtifactsBeforeExecution = getAgentSectionRenderArtifacts();
    const aborter = new AbortController();
    setChatGenerating(true);
    setActiveAborter(aborter);
    const releaseCommandCancellation = trackedWorkLease
        ? agentRunCancellation.bindAbortController({
              runId: confirmation.runId,
              lease: trackedWorkLease,
              controller: aborter,
              reason: 'User cancelled the run while confirmed command execution was active.',
          })
        : null;
    let batchResult: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
    let cancellationTriggeredByInvalidation = false;
    // Capture before the batch owner exists. The check binds that exact owner
    // on its first in-transaction call and retains it across handler awaits.
    const isProjectMutationAuthorized = captureProjectMutationAuthorization();
    // Ownerless-mutation baseline for the post-batch rebind gate. The batch's
    // own writes (including its idempotency checkpoint) are owner-attributed,
    // so only a foreign writer moves this counter.
    const unownedMutationsBeforeBatch = captureUnownedProjectMutations();
    let renderJobAttempts = 0;
    try {
        const executionOptions = {
            ...group,
            signal: aborter.signal,
            source: 'prompt' as const,
            onDeferredEffectAttempt: (attempt: {
                kind: 'work-attempt';
                operation: AppAction['type'];
                workId: string;
            }) => {
                if (attempt.operation === 'renderProjectSections') {
                    renderJobAttempts += 1;
                }
            },
            onProjectCommitCheckpoint: ({ receipt }: { receipt: CommandVerifiedBatchReceipt }) => {
                return prepareAgentRunPendingEffectContinuation({
                    runId: confirmation.runId,
                    receipt,
                    commandBatch,
                });
            },
            requireCompensation: confirmation.executionMode === 'atomic',
            shouldExecute: () => {
                if (!isConfirmationExecutionAuthorized(isProjectMutationAuthorized, aborter.signal)) {
                    return false;
                }
                // Only abort, outside-writer, and actor authorization gate the
                // in-flight batch. The approval itself was fully validated by
                // getApprovalPreflightFailure before execution began, against
                // the pinned proposal revision; re-deriving that revision — or
                // target fingerprints — per action would read state this batch
                // has already mutated, so any batch touching what it plans to
                // change would invalidate itself mid-flight. Outside
                // interference is still caught by the one signal the batch
                // cannot move: mutations not owned by this exact action write
                // scope, including mutations owned by another app action.
                // The actor binding is re-checked separately because a
                // collaborator reconnect rotates localPeerId (same fallback
                // as compileAgentRiskApproval) without mutating anything.
                const approved = confirmation.approvalSnapshot;
                if (!approved.agentApproval) {
                    return true;
                }
                return (collaborationStore.value?.localPeerId ?? 'standalone') === approved.agentApproval.localActorId;
            },
        };
        const approved = confirmation.approvalSnapshot.agentApproval;
        if (!hasPriorVerifiedBatchReceipt && !approved) {
            throw new Error('The command batch has no exact risk approval binding.');
        }
        const approvalBinding =
            !hasPriorVerifiedBatchReceipt && approved
                ? issueAgentCommandApprovalBinding({ approval: approved, commandBatch })
                : undefined;
        await preparePendingActionResourceLeaseForCommit(confirmation.id, commandBatch);
        const versionedResult = await executeVersionedCommandBatchEnvelope({
            authority: commandBatch.authority,
            ...(approvalBinding ? { approvalBinding } : {}),
            serialized: commandBatch.serialized,
            onProjectCommitPrepared: () => protectPendingActionResourceLease(confirmation.id),
            options: executionOptions,
        });
        const failedBeforeCommit =
            versionedResult.status === 'rejected' ||
            versionedResult.status === 'conflicted' ||
            versionedResult.status === 'failed';
        if (
            (!recoveringPendingEffects && versionedResult.status === 'cancelled') ||
            (!recoveringPendingEffects && failedBeforeCommit && !isProjectMutationAuthorized())
        ) {
            cancellationTriggeredByInvalidation = !aborter.signal.aborted;
            await agentRunCancellation.cancel({ runId: confirmation.runId, reason: versionedResult.reason });
        }
        if (versionedResult.status === 'previewed') {
            versionedResult.resource.release();
            throw new Error('A confirmed command batch cannot execute in preview mode');
        }
        batchResult = versionedResult;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: reason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                error: reason,
                content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${reason}`,
            });
            await retainCommittedPendingActionResources(confirmation.id);
            return createCommittedEffectFailureResult(priorVerifiedBatchReceipt, reason);
        }
        let trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = {
            accepted: true,
            warning: null,
        };
        if (trackedWorkLease) {
            trackedLeaseSettlement = settleAgentRunWorkLeaseSafely({
                lease: trackedWorkLease,
                terminalState: 'failed',
                evidence: 'none',
                settle: agentRunWorkLease.settle,
                reportFailure: (error) =>
                    logger.error(new Error('Agent run work lease settlement failed', { cause: error })),
            });
        }
        if (trackedLeaseSettlement.accepted) {
            recordTrackedAgentRunFailure(confirmation, {
                category: error instanceof AiProposalInvalidatedError ? 'conflict' : 'internal',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                knownDomain: error instanceof AiProposalInvalidatedError,
            });
        }
        const userVisibleReason = [reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: userVisibleReason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: userVisibleReason,
            content: `Failed to execute confirmed actions atomically:\n\n${userVisibleReason}`,
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
        return { status: 'failed', reason };
    } finally {
        releaseCommandCancellation?.();
        setActiveAborter(null);
        setChatGenerating(false);
    }

    const committedProjectRevision = captureProjectRevision();
    // The batch flight contains awaited boundaries, so a foreign project write
    // can land between the last render and this capture. Relabelling fresh
    // artifacts against a revision carrying one would defeat the retry's
    // sourceRevision guard, so the rebind runs only when no ownerless mutation
    // landed during the flight. The authorization check is not usable here: the
    // batch's own idempotency checkpoint write falsifies it even on a clean
    // success. A refused relabel leaves the renders detectably incomplete under
    // the committed revision; the project changes themselves stay committed.
    const canRebindSectionRenderArtifacts =
        (batchResult.status === 'committed' || batchResult.status === 'committed-with-warning') &&
        captureUnownedProjectMutations() === unownedMutationsBeforeBatch;
    if (canRebindSectionRenderArtifacts) {
        rebindFreshSectionRenderArtifactsToCommittedRevision(
            confirmation,
            sectionRenderArtifactsBeforeExecution,
            committedProjectRevision
        );
    }
    const budgetPersistenceWarning = commandBudget
        ? updateTrackedAgentRun(confirmation, () => {
              agentWorkBudget.reconcileCommandWork({
                  runId: confirmation.runId,
                  ...commandBudget,
                  actualRenderJobs: renderJobAttempts,
              });
          })
        : null;

    let trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = { accepted: true, warning: null };
    if (trackedWorkLease) {
        const settlementContract = getTrackedLeaseSettlementContract(batchResult);
        trackedLeaseSettlement = settleAgentRunWorkLeaseSafely({
            lease: trackedWorkLease,
            ...settlementContract,
            settle: agentRunWorkLease.settle,
            reportFailure: (error) =>
                logger.error(new Error('Agent run work lease settlement failed', { cause: error })),
        });
    }

    if (batchResult.status === 'idempotent-replay') {
        return settleVerifiedBatchReplay(
            confirmation,
            batchResult.receipt,
            'recoveredExternalEffects' in batchResult && batchResult.recoveredExternalEffects === true,
            trackedLeaseSettlement
        );
    }

    const batchFailedBeforeCommit =
        batchResult.status === 'rejected' || batchResult.status === 'conflicted' || batchResult.status === 'failed';
    if (!recoveringPendingEffects && batchFailedBeforeCommit && !isProjectMutationAuthorized()) {
        return invalidatePendingConfirmation(confirmation);
    }

    if (batchResult.status === 'cancelled') {
        if (aborter.signal.aborted && !cancellationTriggeredByInvalidation) {
            return cancelAcceptedConfirmation(confirmation);
        }
        return invalidatePendingConfirmation(confirmation);
    }

    if (
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'executed' ||
        batchResult.status === 'executed-with-warning'
    ) {
        const executionKind =
            batchResult.status === 'executed' || batchResult.status === 'executed-with-warning' ? 'runtime' : 'project';
        const receiptPersistenceWarning = recordTrackedAgentRunReceipt(confirmation, batchResult.receipt, {
            ...(executionKind === 'project' ? { revertGroupId: group.groupId } : {}),
            completesRun: trackedLeaseSettlement.accepted,
            committedRevision: committedProjectRevision,
        });
        const effectsPending =
            batchResult.receipt.outcome === 'partially-committed' && batchResult.receipt.pendingEffects.length > 0;
        const effectsPendingReason = batchResult.receipt.warnings[0] ?? batchResult.receipt.modelSummary;
        const runPersistenceWarning = [
            receiptPersistenceWarning.warning,
            trackedLeaseSettlement.warning,
            budgetPersistenceWarning,
        ]
            .filter(Boolean)
            .join(' ');
        await retainCommittedPendingActionResources(confirmation.id);
        const approvalLabelsByCommandId = getApprovalLabelsByCommandId(confirmation);
        const unprojectedExecutedLabels: PendingActionExecution[] = batchResult.actions.map(
            ({ action, label, receipt }, index) => {
                const approvedLabel = receipt ? approvalLabelsByCommandId.get(receipt.commandId) : undefined;
                const execution: PendingActionExecution = {
                    actionType: action.type,
                    label: approvedLabel ?? confirmation.approvalSnapshot.actionLabels[index] ?? label,
                    executionKind,
                    affectedIds: getPlannedActionAffectedIds(action),
                    ...(receipt
                        ? {
                              commandId: receipt.commandId,
                              commandSchemaVersion: receipt.schemaVersion,
                              applicationAssigned: {
                                  ids: [...receipt.applicationAssigned.ids],
                                  timestamps: [...receipt.applicationAssigned.timestamps],
                              },
                          }
                        : {}),
                    outcome: batchResult.status,
                };
                return execution;
            }
        );
        const executionProjection = projectSectionRenderConfirmation({
            confirmation,
            executions: unprojectedExecutedLabels,
            expectedSourceRevision: committedProjectRevision,
        });
        const executedLabels = executionProjection.executions;
        const executionReceipt = executionProjection.receipt;
        let warning: string | undefined;
        if (batchResult.status === 'committed-with-warning' || batchResult.status === 'executed-with-warning') {
            warning = batchResult.warning;
        }
        if (runPersistenceWarning) {
            warning = [warning, runPersistenceWarning].filter(Boolean).join(' ');
        }
        try {
            for (const execution of executedLabels) {
                recordPendingActionExecution({ confirmationId: confirmation.id, execution });
            }
            const historyGroup: AiActionGroup = {
                id: group.groupId,
                prompt: confirmation.prompt,
                actions: executedLabels.map((entry) => ({
                    kind: 'appAction',
                    actionType: entry.actionType,
                    label: entry.label,
                })),
                groupId: group.groupId,
                timestamp: Date.now(),
                reverted: false,
                executionKind,
            };
            pushAiActionGroup(historyGroup);
            notifyAiChange(
                effectsPending
                    ? `Committed with pending external effects: ${confirmation.prompt}`
                    : `Confirmed: ${confirmation.prompt}`,
                executedLabels.map((entry) => entry.actionType)
            );
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: effectsPending ? 'failed' : 'executed',
                ...(warning ? { error: warning } : {}),
            });
            const sectionRenderProjection = projectSectionRenderConfirmation({
                confirmation,
                expectedSourceRevision: committedProjectRevision,
            });
            const { incompleteSectionRenders, reviewRequiredSectionRenders } = sectionRenderProjection;
            // Arm the render retry only for the exact committed-batch shape the
            // retry gate will later admit; anything else must stay fail-closed.
            // The binding predicates read executedActions, so they run against
            // the freshly recorded confirmation rather than the stale local one.
            const freshConfirmation = getPendingActionConfirmation(confirmation.id) ?? confirmation;
            let retryableSectionRenders = false;
            let manualReviewReason: string | null = null;
            let manualReviewPersistenceWarning: string | null = null;
            if (
                batchResult.status === 'committed-with-warning' &&
                (incompleteSectionRenders || reviewRequiredSectionRenders.length > 0)
            ) {
                const renderFollowUpAdmitted =
                    admitCommittedSectionRenderRetry({
                        confirmation: freshConfirmation,
                        durableReceipt: batchResult.receipt,
                        phase: 'arming',
                    }).status === 'admitted';
                const requiresManualRenderRepair = batchResult.receipt.pendingEffects.some(
                    (effect) =>
                        effect.kind === 'external-effect' &&
                        effect.operation === 'renderProjectSections' &&
                        effect.remediation === 'manual-repair' &&
                        effect.state === 'pending'
                );
                if (!canRebindSectionRenderArtifacts) {
                    manualReviewReason =
                        'Project changed during the original render, so missing original artifacts cannot be retried safely.';
                    manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                        runId: confirmation.runId,
                        batchId: batchResult.receipt.batchId,
                        reason: manualReviewReason,
                    });
                    const surfacedManualReviewError = [
                        manualReviewReason,
                        manualReviewPersistenceWarning,
                        runPersistenceWarning,
                    ]
                        .filter(Boolean)
                        .join(' ');
                    updatePendingActionFollowUp({
                        confirmationId: confirmation.id,
                        error: surfacedManualReviewError,
                        projectRevision: null,
                        status: 'failed',
                    });
                    updatePendingActionConfirmationStatus({
                        confirmationId: confirmation.id,
                        status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                        error: surfacedManualReviewError,
                    });
                } else if (requiresManualRenderRepair) {
                    manualReviewReason =
                        reviewRequiredSectionRenders.length > 0
                            ? `Section render artifacts require manual review: ${formatSectionRenderReviewSummary(reviewRequiredSectionRenders)}.`
                            : (batchResult.warning ?? 'Section render artifacts require manual repair.');
                    manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                        runId: confirmation.runId,
                        batchId: batchResult.receipt.batchId,
                        reason: manualReviewReason,
                    });
                    const surfacedManualReviewError = [
                        manualReviewReason,
                        manualReviewPersistenceWarning,
                        runPersistenceWarning,
                    ]
                        .filter(Boolean)
                        .join(' ');
                    updatePendingActionFollowUp({
                        confirmationId: confirmation.id,
                        error: surfacedManualReviewError,
                        projectRevision: null,
                        status: 'failed',
                    });
                    updatePendingActionConfirmationStatus({
                        confirmationId: confirmation.id,
                        status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                        error: surfacedManualReviewError,
                    });
                } else if (renderFollowUpAdmitted && incompleteSectionRenders) {
                    retryableSectionRenders = true;
                    updatePendingActionFollowUp({
                        confirmationId: confirmation.id,
                        error: batchResult.warning,
                        projectRevision: committedProjectRevision,
                        status: 'retryable',
                    });
                } else if (renderFollowUpAdmitted && reviewRequiredSectionRenders.length > 0) {
                    const reviewSummary = formatSectionRenderReviewSummary(reviewRequiredSectionRenders);
                    manualReviewReason = `Section render artifacts require manual review: ${reviewSummary}.`;
                    manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                        runId: confirmation.runId,
                        batchId: batchResult.receipt.batchId,
                        reason: manualReviewReason,
                    });
                    const surfacedManualReviewError = [
                        manualReviewReason,
                        manualReviewPersistenceWarning,
                        runPersistenceWarning,
                    ]
                        .filter(Boolean)
                        .join(' ');
                    updatePendingActionFollowUp({
                        confirmationId: confirmation.id,
                        error: surfacedManualReviewError,
                        projectRevision: committedProjectRevision,
                        status: 'failed',
                    });
                    updatePendingActionConfirmationStatus({
                        confirmationId: confirmation.id,
                        status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                        error: surfacedManualReviewError,
                    });
                }
            }
            let content = `Executed after confirmation:\n\n${executionReceipt}`;
            if (receiptPersistenceWarning.effectsPending) {
                content = `${content}\n\nExternal render or analysis effects remain pending; this run is not complete.`;
            }
            if (batchResult.status === 'committed-with-warning') {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
                if (retryableSectionRenders) {
                    content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not replay the confirmed project actions. Retry missing renders below; only receipt-bound missing artifacts will run.`;
                }
                if (manualReviewReason) {
                    content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project commands were not replayed. ${manualReviewReason}${manualReviewPersistenceWarning ? `\n\n${manualReviewPersistenceWarning}` : ''}`;
                }
            }
            if (effectsPending && !manualReviewReason) {
                const manualRepairRequired = batchResult.receipt.pendingEffects.some(
                    ({ remediation }) => remediation === 'manual-repair'
                );
                content = `The project change is durably committed:\n\n${executionReceipt}\n\nAt least one external effect remains pending: ${effectsPendingReason}. ${manualRepairRequired ? 'Use the retained manual-repair guidance' : 'Use the retained pending-effect reconciliation action on the authoritative collaboration host'}; the project mutation will not replay.`;
            }
            if (batchResult.status === 'executed-with-warning') {
                content = `Executed after confirmation:\n\n${executionReceipt}\n\nThe runtime command executed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            }
            if (runPersistenceWarning) {
                content = `${content}\n\n${runPersistenceWarning}`;
            }
            let pendingActionFollowUpStatus: 'failed' | 'retryable' | undefined;
            if (manualReviewReason) {
                pendingActionFollowUpStatus = 'failed';
            } else if (retryableSectionRenders) {
                pendingActionFollowUpStatus = 'retryable';
            }
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus:
                    (effectsPending && !manualReviewReason) || manualReviewPersistenceWarning ? 'failed' : 'executed',
                pendingActionFollowUpStatus,
                error: manualReviewReason
                    ? [manualReviewReason, manualReviewPersistenceWarning, runPersistenceWarning]
                          .filter(Boolean)
                          .join(' ')
                    : warning,
                content,
            });
        } catch (error) {
            const warning = error instanceof Error ? error.message : String(error);
            logger.error(new Error('Confirmed AI action reporting failed after execution', { cause: error }));
            try {
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: effectsPending ? 'failed' : 'executed',
                    error: warning,
                });
                let executionDescription = 'project change committed';
                if (executionKind === 'runtime') {
                    executionDescription = 'runtime command executed';
                }
                updateChatMessage(confirmation.assistantMessageId, {
                    pendingActionConfirmationStatus: effectsPending ? 'failed' : 'executed',
                    error: warning,
                    content: effectsPending
                        ? `The project change is durably committed and external effects remain pending, but reporting also failed: ${warning}. Use the retained reconciliation or manual-repair guidance.\n\n${executionReceipt}`
                        : `The confirmed ${executionDescription}, but reporting it failed: ${warning}. Do not retry these actions.\n\n${executionReceipt}`,
                });
            } catch (reportingError) {
                logger.error(
                    new Error('Confirmed AI post-execution warning could not be persisted', {
                        cause: reportingError,
                    })
                );
            }
        }
        if (effectsPending) {
            return createCommittedEffectFailureResult(batchResult.receipt, effectsPendingReason);
        }
        return { status: 'executed' };
    }

    if (batchResult.status === 'no-op') {
        if (!trackedLeaseSettlement.accepted) {
            const warning = trackedLeaseSettlement.warning ?? AGENT_RUN_PERSISTENCE_WARNING;
            await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'cancelled',
                error: warning,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'cancelled',
                error: warning,
                content: `No project changes were needed after confirmation, but the run was already cancelled or replaced. ${warning}`,
            });
            return { status: 'cancelled' };
        }
        updateTrackedAgentRun(confirmation, () => {
            if (trackedWorkLease) {
                agentRunLifecycle.updateBatchStatus({
                    runId: confirmation.runId,
                    batchId: trackedWorkLease.workId,
                    status: 'no-op',
                });
            }
            agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            ...(trackedLeaseSettlement.warning ? { error: trackedLeaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: trackedLeaseSettlement.warning ?? undefined,
            content: ['No project changes were needed after confirmation.', trackedLeaseSettlement.warning]
                .filter(Boolean)
                .join(' '),
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
        const userVisibleReason = [batchResult.reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
        if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
            await retainCommittedPendingActionResources(confirmation.id);
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: userVisibleReason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                error: userVisibleReason,
                content: `The project change remains durably committed, but pending-effect reconciliation is still incomplete: ${userVisibleReason}`,
            });
            return createCommittedEffectFailureResult(priorVerifiedBatchReceipt, batchResult.reason);
        }
        if (trackedLeaseSettlement.accepted) {
            recordTrackedAgentRunFailure(confirmation, {
                category: 'conflict',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                compensation: 'manual-repair',
            });
        }
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
        await recoverPreparedStemImportResources({ runId: confirmation.runId });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: userVisibleReason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: userVisibleReason,
            content: `The confirmed command stopped after an uncertain partial commit: ${batchResult.reason}. Do not retry it; inspect the project first.${trackedLeaseSettlement.warning ? ` ${trackedLeaseSettlement.warning}` : ''}`,
        });
        return { status: 'failed', reason: batchResult.reason };
    }

    if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
        await retainCommittedPendingActionResources(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: batchResult.reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: batchResult.reason,
            content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${batchResult.reason}`,
        });
        return createCommittedEffectFailureResult(priorVerifiedBatchReceipt, batchResult.reason);
    }

    const userVisibleFailure = [batchResult.reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: userVisibleFailure,
    });
    let failureCategory: AgentRunErrorCategory = 'project';
    if (batchResult.status === 'conflicted') {
        failureCategory = 'conflict';
    } else if (batchResult.status === 'rejected') {
        failureCategory = 'authorization';
    }
    if (trackedLeaseSettlement.accepted) {
        recordTrackedAgentRunFailure(confirmation, {
            category: failureCategory,
            retriable: false,
            ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
        });
    }
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: userVisibleFailure,
        content: `Failed to execute confirmed actions atomically:\n\n${userVisibleFailure}`,
    });
    await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason: batchResult.reason };
}

async function failApprovalPreflight(
    confirmation: PendingAppActionConfirmation,
    reason: string,
    category: AgentRunErrorCategory
): Promise<ConfirmPendingChatActionsResult> {
    recordTrackedAgentRunFailure(confirmation, {
        category,
        retriable: true,
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: reason,
        content: `The confirmed command was rejected before execution: ${reason}`,
    });
    await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason };
}

async function invalidatePendingConfirmation(
    confirmation: PendingAppActionConfirmation
): Promise<Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }>> {
    const reason = new AiProposalInvalidatedError().message;
    await agentRunCancellation.cancel({ runId: confirmation.runId, reason });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'invalidated',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: reason,
        content:
            'This proposal was not executed because the project changed after it was created. Review the current project and submit the command again.',
    });
    await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason };
}

async function invalidatePendingConfirmationForDivergence(
    confirmation: PendingAppActionConfirmation,
    divergence: ApprovalDivergence
): Promise<Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }>> {
    const targetIds = divergence.targetIds.length > 0 ? divergence.targetIds.join(', ') : 'none';
    const candidates = divergence.repairCandidates
        .map((candidate) => `${candidate.kind}: ${candidate.targetIds.join(', ') || 'project'}`)
        .join('; ');
    const reason = `The approved command was not executed because project divergence is ${divergence.kind}.`;
    await agentRunCancellation.cancel({ runId: confirmation.runId, reason });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'invalidated',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: reason,
        content: `${reason} Affected targets: ${targetIds}.${candidates ? ` Repair candidates: ${candidates}.` : ''} Review the current project before planning again.`,
    });
    await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason, divergence };
}

async function cancelAcceptedConfirmation(
    confirmation: PendingAppActionConfirmation
): Promise<ConfirmPendingChatActionsResult> {
    updateTrackedAgentRun(confirmation, () => {
        agentRunLifecycle.cancel({ runId: confirmation.runId, reason: 'User cancelled before the command committed.' });
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'cancelled',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        error: undefined,
        content: 'Command cancelled before it committed. No project changes were applied.',
    });
    await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'cancelled' };
}
