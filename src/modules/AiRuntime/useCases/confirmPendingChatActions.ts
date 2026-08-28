import { logger } from '#/infra/logger/appLogger';
import {
    getAgentSectionRenderArtifacts,
    rebindAgentProjectSectionArtifactRevisions,
    retryAgentProjectSectionRenders,
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
    replacePendingActionExecutions,
    settlePendingActionResourceLeaseBestEffort,
    type PendingActionExecution,
    type PendingAppActionConfirmation,
    updatePendingActionFollowUp,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { normalizeAgentFailure } from './agentErrorAndSaga';
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
import { getExactAgentActionHash } from './getExactAgentActionHash';
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
            const warning = AGENT_RUN_STALE_COMPLETION_WARNING;
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
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'The prior verified receipt records a no-op. No project or runtime effects were applied.',
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
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'cancelled',
            error: undefined,
            content: 'The prior verified receipt records cancellation before commit. No project changes were applied.',
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

function getSectionRenderReceiptScope(
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null = confirmation.followUpProjectRevision
) {
    const renderAction = confirmation.approvalSnapshot.actions.find(
        (action) => action.type === 'renderProjectSections'
    );
    if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
        return null;
    }
    const artifacts = getAgentSectionRenderArtifacts();
    const completedJobIds = new Set<string>();
    const completedAffectedIds = new Set<string>();
    for (const job of renderAction.payload.jobs) {
        const matchingArtifact = artifacts.some(
            (artifact) =>
                artifact.jobId === job.jobId &&
                artifact.sectionId === job.sectionId &&
                artifact.sectionName === job.sectionName &&
                artifact.startBeat === job.startBeat &&
                artifact.endBeat === job.endBeat &&
                artifact.sampleRate === job.sampleRate &&
                artifact.tailSeconds === job.tailSeconds &&
                artifact.sourceRevision === expectedSourceRevision
        );
        if (matchingArtifact) {
            completedJobIds.add(job.jobId);
            completedAffectedIds.add(job.sectionId);
            completedAffectedIds.add(job.jobId);
        }
    }
    return {
        jobs: renderAction.payload.jobs,
        plannedAffectedIds: getPlannedActionAffectedIds(renderAction),
        plannedRenderAffectedIds: new Set(renderAction.payload.jobs.flatMap((job) => [job.sectionId, job.jobId])),
        completedAffectedIds,
        completedJobIds,
    };
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

function getActualExecutionAffectedIds(
    execution: PendingActionExecution,
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null = confirmation.followUpProjectRevision
): string[] {
    if (execution.actionType !== 'renderProjectSections') {
        return execution.affectedIds;
    }
    const scope = getSectionRenderReceiptScope(confirmation, expectedSourceRevision);
    if (!scope) {
        return execution.affectedIds;
    }
    const nonRenderAffectedIds = execution.affectedIds.filter((id) => !scope.plannedRenderAffectedIds.has(id));
    const completedPlannedAffectedIds = scope.plannedAffectedIds.filter((id) => scope.completedAffectedIds.has(id));
    return [...new Set([...nonRenderAffectedIds, ...completedPlannedAffectedIds])];
}

function refreshPendingActionExecutions(
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null = confirmation.followUpProjectRevision
): PendingAppActionConfirmation {
    const current = getPendingActionConfirmation(confirmation.id) ?? confirmation;
    const executions = current.executedActions.map((execution) => ({
        ...execution,
        affectedIds: getActualExecutionAffectedIds(execution, current, expectedSourceRevision),
    }));
    return replacePendingActionExecutions({ confirmationId: current.id, executions }) ?? current;
}

function formatExecutionReceipt(
    executions: readonly PendingActionExecution[],
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null = confirmation.followUpProjectRevision
): string {
    const executedActions = executions
        .map((execution) => {
            const actualAffectedIds = getActualExecutionAffectedIds(execution, confirmation, expectedSourceRevision);
            const affectedIds = actualAffectedIds.length > 0 ? actualAffectedIds.join(', ') : 'none';
            const assignedIds = (execution.applicationAssigned?.ids ?? [])
                .map(({ field, value }) => `${field}=${value}`)
                .join(', ');
            const assignedTimestamps = (execution.applicationAssigned?.timestamps ?? [])
                .map(({ field, value }) => `${field}=${String(value)}`)
                .join(', ');
            const commandMetadata = execution.commandId
                ? `\n  - Command: v${String(execution.commandSchemaVersion)} ${execution.commandId}\n  - Application-assigned IDs: ${assignedIds || 'none'}\n  - Application-assigned timestamps: ${assignedTimestamps || 'none'}`
                : '';
            return `- **${execution.actionType}**: ${execution.label}${commandMetadata}\n  - Affected IDs: ${affectedIds}\n  - Outcome: ${execution.outcome}`;
        })
        .join('\n');
    const protectedAffectedIds = new Set(
        executions.flatMap((execution) =>
            getActualExecutionAffectedIds(execution, confirmation, expectedSourceRevision)
        )
    );
    const approvedProtectedTargets = confirmation.approvalSnapshot.protectedUnchanged;
    const preservedProtectedTargets = approvedProtectedTargets.every((target) => !protectedAffectedIds.has(target.id));
    if (!preservedProtectedTargets) {
        return executedActions;
    }
    const protectedUnchanged = approvedProtectedTargets.map((target) => `"${target.name}" (${target.id})`).join(', ');
    if (!protectedUnchanged) {
        return executedActions;
    }
    return `${executedActions}\n\nProtected unchanged: ${protectedUnchanged}`;
}

function getIncompleteSectionRenderJobs(
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null = confirmation.followUpProjectRevision
) {
    const scope = getSectionRenderReceiptScope(confirmation, expectedSourceRevision);
    if (!scope) {
        return null;
    }
    const jobs = scope.jobs.filter((job) => !scope.completedJobIds.has(job.jobId));
    return jobs.length > 0 ? { jobs, missingJobIds: jobs.map((job) => job.jobId) } : null;
}

function completeCommittedSectionRenderRetry(receipt: CommandVerifiedBatchReceipt): void {
    agentRunLifecycle.completePendingEffectContinuation({
        runId: receipt.runId,
        batchId: receipt.batchId,
        receiptIdentity: getVerifiedReceiptIdentity(receipt),
    });
}

async function retryCommittedSectionRenders(
    confirmation: PendingAppActionConfirmation,
    durableReceipt: CommandVerifiedBatchReceipt
): ConfirmPendingChatActionsOutput {
    if (chatStore.value?.isGenerating === true) {
        return { status: 'busy' };
    }
    const followUp = getIncompleteSectionRenderJobs(confirmation);
    if (!followUp) {
        try {
            completeCommittedSectionRenderRetry(durableReceipt);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: reason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                pendingActionFollowUpStatus: 'retryable',
                error: reason,
                content: `All expected section render artifacts are present, but durable retry completion could not be recorded: ${reason}. Project actions were not replayed.`,
            });
            return { status: 'failed', reason };
        }
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'complete',
            error: undefined,
            content: `Applied after confirmation:\n\n${formatExecutionReceipt(
                refreshedConfirmation.executedActions,
                refreshedConfirmation
            )}\n\nAll section render artifacts are complete; project actions were not replayed.`,
        });
        return { status: 'executed' };
    }

    const sourceRevision = confirmation.followUpProjectRevision;
    if (!sourceRevision || captureProjectRevision() !== sourceRevision) {
        const reason =
            'Project changed after the committed render receipt; the missing original artifacts cannot be recreated safely.';
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'failed' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'failed',
            error: reason,
            content: `The project changes remain committed, but the missing section renders were not retried: ${reason}`,
        });
        return { status: 'failed', reason };
    }

    const trackedRun = agentRunLifecycle.get(confirmation.runId);
    const renderRetryBudget = (() => {
        if (!trackedRun) {
            return null;
        }
        const retryPrefix = `render-retry:${confirmation.id}:`;
        const attemptId = `${retryPrefix}${trackedRun.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith(retryPrefix)).length + 1}`;
        const reservation = agentRunLifecycle.reserveBudget({
            runId: confirmation.runId,
            attemptId,
            category: 'maxRenderJobs',
            estimate: followUp.jobs.length,
            provenance: 'versioned-estimate',
        });
        return { attemptId, reservation };
    })();
    if (renderRetryBudget?.reservation.status === 'hard-limit-reached') {
        const reason = `The missing section renders exceed the user budget for ${renderRetryBudget.reservation.reason}.`;
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'retryable',
            error: reason,
            content: `The project changes remain committed, but the missing section renders were not retried because they exceed the user budget: ${reason}`,
        });
        return { status: 'failed', reason };
    }

    updatePendingActionFollowUp({ confirmationId: confirmation.id, status: 'running' });
    updateChatMessage(confirmation.assistantMessageId, { pendingActionFollowUpStatus: 'running' });
    setChatGenerating(true);
    try {
        await retryAgentProjectSectionRenders({ jobs: followUp.jobs, sourceRevision });
        const remaining = getIncompleteSectionRenderJobs(confirmation);
        if (remaining) {
            throw new Error(`Section render jobs remain incomplete: ${remaining.missingJobIds.join(', ')}`);
        }
        completeCommittedSectionRenderRetry(durableReceipt);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
        const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'retryable',
            error: reason,
            content: `Applied after confirmation:\n\n${formatExecutionReceipt(
                refreshedConfirmation.executedActions,
                refreshedConfirmation
            )}\n\nThe project actions remain committed. Missing section renders are still incomplete: ${reason}. Retry missing renders without replaying the project actions.`,
        });
        return { status: 'failed', reason };
    } finally {
        if (renderRetryBudget?.reservation.status === 'reserved') {
            const remainingJobs = getIncompleteSectionRenderJobs(confirmation);
            const completedJobsCount = Math.max(0, followUp.jobs.length - (remainingJobs?.missingJobIds.length ?? 0));
            agentRunLifecycle.reconcileBudgetAttempt({
                runId: confirmation.runId,
                attemptId: renderRetryBudget.attemptId,
                consumed: completedJobsCount,
                mode: 'final',
                provenance: 'versioned-estimate',
            });
        }
        setChatGenerating(false);
    }

    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'complete',
        error: undefined,
        content: `Applied after confirmation:\n\n${formatExecutionReceipt(
            refreshedConfirmation.executedActions,
            refreshedConfirmation
        )}\n\nMissing section render artifacts completed without replaying project actions.`,
    });
    return { status: 'executed' };
}

type ValidApprovedCommandBatch = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];
type ApprovedCommand = ValidApprovedCommandBatch['commands'][number];
type ApprovedCommandBatch = NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
type ApprovedRenderAction = Extract<
    PendingAppActionConfirmation['approvalSnapshot']['actions'][number],
    { type: 'renderProjectSections' }
>;
type ParsedApprovedRetryBatch = {
    commands: ValidApprovedCommandBatch['commands'];
    commandsById: ReadonlyMap<string, ApprovedCommand>;
    envelope: ValidApprovedCommandBatch;
};
type WarnedRenderPayloadBinding = {
    approvedCommand: ApprovedCommand;
    renderAction: ApprovedRenderAction;
};

function isEligibleForCommittedSectionRenderRetry(confirmation: PendingAppActionConfirmation): boolean {
    return (
        (confirmation.status === 'executed' || confirmation.status === 'failed') &&
        confirmation.followUpStatus === 'retryable' &&
        confirmation.followUpProjectRevision !== null
    );
}

function parseApprovedRetryBatch(confirmation: PendingAppActionConfirmation): ParsedApprovedRetryBatch | null {
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!approvedCommandBatch) {
        return null;
    }
    const parsedBatch = parseVersionedCommandBatchEnvelope(
        approvedCommandBatch.serialized,
        approvedCommandBatch.authority
    );
    if (parsedBatch.status !== 'valid') {
        return null;
    }

    const commandsById = new Map<string, ApprovedCommand>(
        parsedBatch.envelope.commands.map((command) => [command.commandId, command])
    );
    return { commands: parsedBatch.envelope.commands, commandsById, envelope: parsedBatch.envelope };
}

function hasExactApprovedCommandBatchIdentity(
    expected: ApprovedCommandBatch,
    candidate: PendingAppActionConfirmation['approvalSnapshot']['commandBatch']
): boolean {
    return (
        candidate !== undefined &&
        candidate.serialized === expected.serialized &&
        hasExactCanonicalCommandBatchAuthority(expected.authority, candidate.authority)
    );
}

function hasExactCanonicalCommandBatchAuthority(expected: unknown, candidate: unknown): boolean {
    return (
        getExactAgentActionHash({ operation: 'commandBatchAuthority', arguments: candidate }) ===
        getExactAgentActionHash({ operation: 'commandBatchAuthority', arguments: expected })
    );
}

function hasExactCommittedProjectReceiptBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch
): boolean {
    if (confirmation.executedActions.length !== approvedBatch.commands.length) {
        return false;
    }
    const committedCommandIds = new Set<string>();
    for (const execution of confirmation.executedActions) {
        if (!execution.commandId) {
            return false;
        }
        const approvedCommand = approvedBatch.commandsById.get(execution.commandId);
        if (!approvedCommand) {
            return false;
        }
        if (committedCommandIds.has(approvedCommand.commandId)) {
            return false;
        }
        if (execution.actionType !== approvedCommand.operation) {
            return false;
        }
        if (execution.commandSchemaVersion !== approvedCommand.schemaVersion) {
            return false;
        }
        if (execution.executionKind !== 'project') {
            return false;
        }
        if (execution.outcome !== 'committed' && execution.outcome !== 'committed-with-warning') {
            return false;
        }
        committedCommandIds.add(approvedCommand.commandId);
    }
    return true;
}

function getWarnedRenderPayloadBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch
): WarnedRenderPayloadBinding | null {
    const approvedRenderCommands = approvedBatch.commands.filter(
        (command) => command.operation === 'renderProjectSections'
    );
    const renderActions = confirmation.approvalSnapshot.actions.filter(
        (action) => action.type === 'renderProjectSections'
    );
    if (approvedRenderCommands.length !== 1 || renderActions.length !== 1) {
        return null;
    }
    const approvedRenderCommand = approvedRenderCommands[0];
    const renderAction = renderActions[0];
    if (!approvedRenderCommand || !renderAction || !getSectionRenderReceiptScope(confirmation)) {
        return null;
    }
    const warnedRenderExecutions = confirmation.executedActions.filter(
        (execution) =>
            execution.commandId === approvedRenderCommand.commandId &&
            execution.actionType === approvedRenderCommand.operation &&
            execution.executionKind === 'project' &&
            execution.outcome === 'committed-with-warning'
    );
    if (warnedRenderExecutions.length !== 1) {
        return null;
    }
    if (
        getExactAgentActionHash({
            operation: renderAction.type,
            arguments: renderAction.payload,
        }) !==
        getExactAgentActionHash({
            operation: approvedRenderCommand.operation,
            arguments: approvedRenderCommand.arguments,
        })
    ) {
        return null;
    }
    return { approvedCommand: approvedRenderCommand, renderAction };
}

function hasExactDurableRenderRecoveryReceipt(
    receipt: CommandVerifiedBatchReceipt | null,
    binding: WarnedRenderPayloadBinding
): boolean {
    if (
        !receipt ||
        receipt.outcome !== 'partially-committed' ||
        receipt.atomicity !== 'durable-atomic-with-non-atomic-effects'
    ) {
        return false;
    }
    const renderCommandOutcomes = receipt.commandOutcomes.filter(
        ({ commandId, operation }) =>
            commandId === binding.approvedCommand.commandId && operation === binding.approvedCommand.operation
    );
    if (renderCommandOutcomes.length !== 1 || renderCommandOutcomes[0]?.outcome !== 'committed') {
        return false;
    }
    if (receipt.pendingEffects.length !== 1) {
        return false;
    }
    const pendingEffect = receipt.pendingEffects[0];
    return (
        pendingEffect?.commandId === binding.approvedCommand.commandId &&
        pendingEffect.operation === binding.approvedCommand.operation &&
        pendingEffect.kind === 'external-effect' &&
        pendingEffect.remediation === 'reconcile' &&
        pendingEffect.state === 'pending'
    );
}

type AdmissibleSectionRenderRetry = {
    approvedBatch: ParsedApprovedRetryBatch;
    renderBinding: WarnedRenderPayloadBinding;
};

// The exact committed-batch shape a section-render retry may bind to, shared by
// the arming decision and the retry gate so neither can admit a shape the other
// would reject.
function getAdmissibleSectionRenderRetry(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt | null
): AdmissibleSectionRenderRetry | null {
    const approvedBatch = parseApprovedRetryBatch(confirmation);
    if (!approvedBatch || !hasExactCommittedProjectReceiptBinding(confirmation, approvedBatch)) {
        return null;
    }
    const renderBinding = getWarnedRenderPayloadBinding(confirmation, approvedBatch);
    if (!renderBinding || !hasExactDurableRenderRecoveryReceipt(receipt, renderBinding)) {
        return null;
    }
    return { approvedBatch, renderBinding };
}

function hasExactConfirmationDurableBatchBinding(
    confirmation: PendingAppActionConfirmation,
    approvedBatch: ParsedApprovedRetryBatch,
    receipt: CommandVerifiedBatchReceipt | null
): boolean {
    return (
        receipt !== null &&
        approvedBatch.envelope.runId === confirmation.runId &&
        receipt.runId === confirmation.runId &&
        approvedBatch.envelope.batchId === confirmation.groupId &&
        receipt.batchId === confirmation.groupId &&
        approvedBatch.envelope.baseRevision === confirmation.projectRevision
    );
}

function hasExactTrackedAgentRunRetryBinding(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt | null
): boolean {
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!receipt || !approvedCommandBatch) {
        return false;
    }
    const trackedRun = agentRunLifecycle.get(confirmation.runId);
    if (!trackedRun || trackedRun.revisions.committed !== confirmation.followUpProjectRevision) {
        return false;
    }
    const receiptIdentity = getVerifiedReceiptIdentity(receipt);
    const matchingReceipts = trackedRun.receipts.filter(({ workId }) => workId === receipt.batchId);
    if (matchingReceipts.length !== 1 || matchingReceipts[0]?.receiptIdentity !== receiptIdentity) {
        return false;
    }
    const matchingContinuations = trackedRun.pendingEffectContinuations.filter(
        ({ batchId }) => batchId === receipt.batchId
    );
    const continuation = matchingContinuations[0];
    return (
        matchingContinuations.length === 1 &&
        continuation?.receiptIdentity === receiptIdentity &&
        continuation.recovery === 'reconcile-batch' &&
        continuation.serializedBatch === approvedCommandBatch.serialized &&
        hasExactCanonicalCommandBatchAuthority(approvedCommandBatch.authority, continuation.authority)
    );
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

function hasDurablyCommittedRetryableSectionRender(
    confirmation: PendingAppActionConfirmation,
    durableReceipt: CommandVerifiedBatchReceipt | null
): boolean {
    if (!isEligibleForCommittedSectionRenderRetry(confirmation)) {
        return false;
    }
    const admissible = getAdmissibleSectionRenderRetry(confirmation, durableReceipt);
    return (
        admissible !== null &&
        hasExactConfirmationDurableBatchBinding(confirmation, admissible.approvedBatch, durableReceipt) &&
        hasExactTrackedAgentRunRetryBinding(confirmation, durableReceipt)
    );
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
    const wasRetryEligible = isEligibleForCommittedSectionRenderRetry(confirmation);
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
        if (
            !hasExactApprovedCommandBatchIdentity(
                approvedCommandBatch,
                refreshedConfirmation.approvalSnapshot.commandBatch
            ) ||
            (wasRetryEligible && !isEligibleForCommittedSectionRenderRetry(refreshedConfirmation)) ||
            (wasProposed && refreshedConfirmation.status !== 'proposed')
        ) {
            return { status: 'not_pending', currentStatus: refreshedConfirmation.status };
        }
        confirmation = refreshedConfirmation;
    }
    if (
        priorVerifiedBatchReceipt &&
        hasDurablyCommittedRetryableSectionRender(confirmation, priorVerifiedBatchReceipt)
    ) {
        return retryCommittedSectionRenders(confirmation, priorVerifiedBatchReceipt);
    }
    if (wasRetryEligible && isEligibleForCommittedSectionRenderRetry(confirmation)) {
        return failCommittedSectionRenderRetryProof(confirmation);
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
    try {
        const executionOptions = {
            ...group,
            signal: aborter.signal,
            source: 'prompt' as const,
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
        let canUpdateTrackedRun = true;
        if (trackedWorkLease) {
            canUpdateTrackedRun = settleAgentRunWorkLeaseSafely({
                lease: trackedWorkLease,
                terminalState: 'failed',
                settle: agentRunWorkLease.settle,
                reportFailure: (error) =>
                    logger.error(new Error('Agent run work lease settlement failed', { cause: error })),
            }).accepted;
        }
        if (canUpdateTrackedRun) {
            recordTrackedAgentRunFailure(confirmation, {
                category: error instanceof AiProposalInvalidatedError ? 'conflict' : 'internal',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                knownDomain: error instanceof AiProposalInvalidatedError,
            });
        }
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `Failed to execute confirmed actions atomically:\n\n${reason}`,
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
    if (
        (batchResult.status === 'committed' || batchResult.status === 'committed-with-warning') &&
        captureUnownedProjectMutations() === unownedMutationsBeforeBatch
    ) {
        rebindFreshSectionRenderArtifactsToCommittedRevision(
            confirmation,
            sectionRenderArtifactsBeforeExecution,
            committedProjectRevision
        );
    }
    const budgetPersistenceWarning = commandBudget
        ? updateTrackedAgentRun(confirmation, () => {
              const incompleteSectionRenders = getIncompleteSectionRenderJobs(confirmation, committedProjectRevision);
              const actualRenderJobs = incompleteSectionRenders
                  ? Math.max(
                        0,
                        (commandBatch.authority.budgets.maxRenderJobs ?? 0) -
                            incompleteSectionRenders.missingJobIds.length
                    )
                  : undefined;
              agentWorkBudget.reconcileCommandWork({
                  runId: confirmation.runId,
                  ...commandBudget,
                  ...(actualRenderJobs !== undefined ? { actualRenderJobs } : {}),
              });
          })
        : null;

    let trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = { accepted: true, warning: null };
    if (trackedWorkLease) {
        let terminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
        if (
            batchResult.status === 'committed' ||
            batchResult.status === 'committed-with-warning' ||
            batchResult.status === 'executed' ||
            batchResult.status === 'executed-with-warning' ||
            batchResult.status === 'idempotent-replay' ||
            batchResult.status === 'no-op'
        ) {
            terminalState = 'completed';
        } else if (batchResult.status === 'cancelled') {
            terminalState = 'cancelled';
        }
        trackedLeaseSettlement = settleAgentRunWorkLeaseSafely({
            lease: trackedWorkLease,
            terminalState,
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
        const executedLabels: PendingActionExecution[] = batchResult.actions.map(
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
                return {
                    ...execution,
                    affectedIds: getActualExecutionAffectedIds(execution, confirmation, committedProjectRevision),
                };
            }
        );
        const executionReceipt = formatExecutionReceipt(executedLabels, confirmation, committedProjectRevision);
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
                ...(effectsPending ? { error: warning } : {}),
            });
            const incompleteSectionRenders = getIncompleteSectionRenderJobs(confirmation, committedProjectRevision);
            // Arm the render retry only for the exact committed-batch shape the
            // retry gate will later admit; anything else must stay fail-closed.
            // The binding predicates read executedActions, so they run against
            // the freshly recorded confirmation rather than the stale local one.
            const freshConfirmation = getPendingActionConfirmation(confirmation.id) ?? confirmation;
            let retryableSectionRenders = false;
            if (incompleteSectionRenders && batchResult.status === 'committed-with-warning') {
                retryableSectionRenders =
                    getAdmissibleSectionRenderRetry(freshConfirmation, batchResult.receipt) !== null;
                if (retryableSectionRenders) {
                    updatePendingActionFollowUp({
                        confirmationId: confirmation.id,
                        error: batchResult.warning,
                        projectRevision: committedProjectRevision,
                        status: 'retryable',
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
            }
            if (effectsPending) {
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
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: effectsPending ? 'failed' : 'executed',
                pendingActionFollowUpStatus: retryableSectionRenders ? 'retryable' : undefined,
                error: warning,
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
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'No project changes were needed after confirmation.',
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
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
                content: `The project change remains durably committed, but pending-effect reconciliation is still incomplete: ${batchResult.reason}`,
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
            error: batchResult.reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: batchResult.reason,
            content: `The confirmed command stopped after an uncertain partial commit: ${batchResult.reason}. Do not retry it; inspect the project first.`,
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

    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: batchResult.reason,
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
        error: batchResult.reason,
        content: `Failed to execute confirmed actions atomically:\n\n${batchResult.reason}`,
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
