import { logger } from '#/infra/logger/appLogger';
import { getAgentSectionRenderArtifacts, retryAgentProjectSectionRenders } from '#/modules/AudioRendering/useCases';
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
import { captureProjectRevision, isDrumPreviewBranchPlanApplied } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import {
    type AgentRunErrorCategory,
    type AgentRunErrorRemediation,
    type AgentRunWorkLease,
    type AgentRunWorkTerminalState,
} from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { chatStore, setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
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
import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget, type AgentWorkBudgetEstimate } from './agentWorkBudget';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { notifyAiChange } from './notifyAiChange';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | {
          status: 'reapproval_required';
          divergence: ApprovalDivergence;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;

const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const AGENT_RUN_STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';

async function settlePendingActionResourcesBestEffort(input: {
    confirmationId: string;
    disposition: 'discard' | 'retain';
}): Promise<void> {
    await settlePendingActionResourceLeaseBestEffort(input);
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
    input?: { revertGroupId?: string; completesRun?: boolean }
): { warning: string | null; effectsPending: boolean } {
    let effectsPending = false;
    const warning = updateTrackedAgentRun(confirmation, () => {
        const recorded = recordAgentRunReceiptSaga({
            runId: confirmation.runId,
            receipt,
            actions: confirmation.actions,
            ...(input?.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            ...(input?.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
            committedRevision: captureProjectRevision(),
        });
        effectsPending = recorded.effectsPending;
        const importedStems = confirmation.actions.flatMap((action) =>
            action.type === 'importStemSet' ? action.payload.stems : []
        );
        if (importedStems.length > 0) {
            preparedStemImportResources.release({ runId: confirmation.runId, stems: importedStems });
        }
    });
    return { warning, effectsPending };
}

type TrackedAgentRunWorkLeaseSettlement = {
    accepted: boolean;
    warning: string | null;
};

function settleTrackedAgentRunWorkLease(
    lease: AgentRunWorkLease,
    terminalState: AgentRunWorkTerminalState
): TrackedAgentRunWorkLeaseSettlement {
    try {
        const settlement = agentRunWorkLease.settle({
            runId: lease.runId,
            workId: lease.workId,
            leaseId: lease.leaseId,
            cancellationGeneration: lease.cancellationGeneration,
            idempotencyKey: lease.idempotencyKey,
            receiptIdentity: lease.receiptIdentity,
            terminalState,
        });
        return {
            accepted: settlement.status === 'settled',
            warning: settlement.status === 'settled' ? null : AGENT_RUN_STALE_COMPLETION_WARNING,
        };
    } catch (error) {
        logger.error(new Error('Agent run work lease settlement failed', { cause: error }));
        return { accepted: true, warning: AGENT_RUN_PERSISTENCE_WARNING };
    }
}

async function settleVerifiedBatchReplay(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt,
    recoveredExternalEffects = false,
    leaseSettlement: TrackedAgentRunWorkLeaseSettlement = { accepted: true, warning: null }
): Promise<ConfirmPendingChatActionsResult> {
    const replay = getVerifiedBatchReplayDisposition(receipt);
    if (replay.status === 'committed' || replay.status === 'executed') {
        const receiptPersistenceWarning = recordTrackedAgentRunReceipt(confirmation, receipt, {
            ...(replay.status === 'committed' && confirmation.groupId ? { revertGroupId: confirmation.groupId } : {}),
            completesRun: leaseSettlement.accepted,
        });
        const runPersistenceWarning = receiptPersistenceWarning.warning ?? leaseSettlement.warning;
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
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
        updateTrackedAgentRun(confirmation, () => {
            agentRunLifecycle.updateBatchStatus({
                runId: confirmation.runId,
                batchId: receipt.batchId,
                status: 'no-op',
            });
            agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
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
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: replay.reason,
    });
    recordTrackedAgentRunFailure(confirmation, {
        category: replay.status === 'ambiguous' ? 'conflict' : 'project',
        retriable: false,
        workId: receipt.batchId,
        receiptIdentity: getVerifiedReceiptIdentity(receipt),
        ...(replay.status === 'ambiguous' ? { compensation: 'manual-repair' as const } : {}),
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: replay.reason,
        content:
            replay.status === 'ambiguous'
                ? `The prior verified receipt records an ambiguous outcome: ${replay.reason}. Do not retry it; inspect the project first.`
                : `The prior verified receipt records that this command batch did not apply successfully: ${replay.reason}`,
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

function isConfirmationExecutionAuthorized(confirmation: PendingAppActionConfirmation, signal: AbortSignal): boolean {
    if (signal.aborted) {
        return false;
    }
    if (captureProjectRevision() === confirmation.projectRevision) {
        return true;
    }
    const actions = confirmation.approvalSnapshot.actions;
    return (
        actions.length === 1 &&
        actions[0]?.type === 'createDrumPreviewBranches' &&
        isDrumPreviewBranchPlanApplied(actions[0])
    );
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

function getSectionRenderReceiptScope(confirmation: PendingAppActionConfirmation) {
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
                artifact.tailSeconds === job.tailSeconds
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

function getActualExecutionAffectedIds(
    execution: PendingActionExecution,
    confirmation: PendingAppActionConfirmation
): string[] {
    if (execution.actionType !== 'renderProjectSections') {
        return execution.affectedIds;
    }
    const scope = getSectionRenderReceiptScope(confirmation);
    if (!scope) {
        return execution.affectedIds;
    }
    const nonRenderAffectedIds = execution.affectedIds.filter((id) => !scope.plannedRenderAffectedIds.has(id));
    const completedPlannedAffectedIds = scope.plannedAffectedIds.filter((id) => scope.completedAffectedIds.has(id));
    return [...new Set([...nonRenderAffectedIds, ...completedPlannedAffectedIds])];
}

function refreshPendingActionExecutions(confirmation: PendingAppActionConfirmation): PendingAppActionConfirmation {
    const current = getPendingActionConfirmation(confirmation.id) ?? confirmation;
    const executions = current.executedActions.map((execution) => ({
        ...execution,
        affectedIds: getActualExecutionAffectedIds(execution, current),
    }));
    return replacePendingActionExecutions({ confirmationId: current.id, executions }) ?? current;
}

function formatExecutionReceipt(
    executions: readonly PendingActionExecution[],
    confirmation: PendingAppActionConfirmation
): string {
    const executedActions = executions
        .map((execution) => {
            const actualAffectedIds = getActualExecutionAffectedIds(execution, confirmation);
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
        executions.flatMap((execution) => getActualExecutionAffectedIds(execution, confirmation))
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

function getIncompleteSectionRenderJobs(confirmation: PendingAppActionConfirmation) {
    const scope = getSectionRenderReceiptScope(confirmation);
    if (!scope) {
        return null;
    }
    const jobs = scope.jobs.filter((job) => !scope.completedJobIds.has(job.jobId));
    return jobs.length > 0 ? { jobs, missingJobIds: jobs.map((job) => job.jobId) } : null;
}

async function retryCommittedSectionRenders(
    confirmation: PendingAppActionConfirmation
): ConfirmPendingChatActionsOutput {
    if (chatStore.value?.isGenerating === true) {
        return { status: 'busy' };
    }
    const followUp = getIncompleteSectionRenderJobs(confirmation);
    if (!followUp) {
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
        updateChatMessage(confirmation.assistantMessageId, {
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
            agentRunLifecycle.reconcileBudgetAttempt({
                runId: confirmation.runId,
                attemptId: renderRetryBudget.attemptId,
                consumed: followUp.jobs.length,
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

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status === 'executed' && confirmation.followUpStatus === 'retryable') {
        return retryCommittedSectionRenders(confirmation);
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    let hasPriorVerifiedBatchReceipt = false;
    if (approvedCommandBatch) {
        const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
            authority: approvedCommandBatch.authority,
            serialized: approvedCommandBatch.serialized,
        });
        hasPriorVerifiedBatchReceipt = priorReceipt !== null;
    }

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
    try {
        const executionOptions = {
            ...group,
            signal: aborter.signal,
            source: 'prompt' as const,
            requireCompensation: confirmation.executionMode === 'atomic',
            shouldExecute: () => {
                if (!isConfirmationExecutionAuthorized(confirmation, aborter.signal)) {
                    return false;
                }
                // Only abort, revision, and actor authorization gate the
                // in-flight batch. The approval itself was fully validated by
                // getApprovalPreflightFailure before execution began;
                // re-deriving target fingerprints per action would read
                // target state this batch has already mutated, so any
                // multi-action batch touching a fingerprinted target would
                // invalidate itself mid-flight. External interference is
                // still caught here: every project mutation moves the
                // revision heads isConfirmationExecutionAuthorized compares.
                // The actor binding is re-checked separately because a
                // collaborator reconnect rotates localPeerId (same fallback
                // as compileAgentRiskApproval) without moving those heads.
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
        const versionedResult = await executeVersionedCommandBatchEnvelope({
            authority: commandBatch.authority,
            ...(approvalBinding ? { approvalBinding } : {}),
            serialized: commandBatch.serialized,
            options: executionOptions,
        });
        const failedBeforeCommit =
            versionedResult.status === 'rejected' ||
            versionedResult.status === 'conflicted' ||
            versionedResult.status === 'failed';
        if (
            versionedResult.status === 'cancelled' ||
            (failedBeforeCommit && captureProjectRevision() !== confirmation.projectRevision)
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
        let canUpdateTrackedRun = true;
        if (trackedWorkLease) {
            canUpdateTrackedRun = settleTrackedAgentRunWorkLease(trackedWorkLease, 'failed').accepted;
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

    const budgetPersistenceWarning = commandBudget
        ? updateTrackedAgentRun(confirmation, () => {
              agentWorkBudget.reconcileCommandWork({ runId: confirmation.runId, ...commandBudget });
          })
        : null;

    let trackedLeaseSettlement: TrackedAgentRunWorkLeaseSettlement = { accepted: true, warning: null };
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
        trackedLeaseSettlement = settleTrackedAgentRunWorkLease(trackedWorkLease, terminalState);
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
    if (batchFailedBeforeCommit && captureProjectRevision() !== confirmation.projectRevision) {
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
        });
        const runPersistenceWarning = [
            receiptPersistenceWarning.warning,
            trackedLeaseSettlement.warning,
            budgetPersistenceWarning,
        ]
            .filter(Boolean)
            .join(' ');
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
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
                    affectedIds: getActualExecutionAffectedIds(execution, confirmation),
                };
            }
        );
        const executionReceipt = formatExecutionReceipt(executedLabels, confirmation);
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
                `Confirmed: ${confirmation.prompt}`,
                executedLabels.map((entry) => entry.actionType)
            );
            updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
            const incompleteSectionRenders = getIncompleteSectionRenderJobs(confirmation);
            if (incompleteSectionRenders && batchResult.status === 'committed-with-warning') {
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: batchResult.warning,
                    projectRevision: captureProjectRevision(),
                    status: 'retryable',
                });
            }
            let content = `Executed after confirmation:\n\n${executionReceipt}`;
            if (receiptPersistenceWarning.effectsPending) {
                content = `${content}\n\nExternal render or analysis effects remain pending; this run is not complete.`;
            }
            if (batchResult.status === 'committed-with-warning') {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
                if (incompleteSectionRenders) {
                    content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not replay the confirmed project actions. Retry missing renders below; only receipt-bound missing artifacts will run.`;
                }
            }
            if (batchResult.status === 'executed-with-warning') {
                content = `Executed after confirmation:\n\n${executionReceipt}\n\nThe runtime command executed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            }
            if (runPersistenceWarning) {
                content = `${content}\n\n${runPersistenceWarning}`;
            }
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'executed',
                pendingActionFollowUpStatus: incompleteSectionRenders ? 'retryable' : undefined,
                error: warning,
                content,
            });
        } catch (error) {
            const warning = error instanceof Error ? error.message : String(error);
            logger.error(new Error('Confirmed AI action reporting failed after execution', { cause: error }));
            try {
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: 'executed',
                    error: warning,
                });
                let executionDescription = 'project change committed';
                if (executionKind === 'runtime') {
                    executionDescription = 'runtime command executed';
                }
                updateChatMessage(confirmation.assistantMessageId, {
                    pendingActionConfirmationStatus: 'executed',
                    error: warning,
                    content: `The confirmed ${executionDescription}, but reporting it failed: ${warning}. Do not retry these actions.\n\n${executionReceipt}`,
                });
            } catch (reportingError) {
                logger.error(
                    new Error('Confirmed AI post-execution warning could not be persisted', {
                        cause: reportingError,
                    })
                );
            }
        }
        return { status: 'executed' };
    }

    if (batchResult.status === 'no-op') {
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
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'No project changes were needed after confirmation.',
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
        recordTrackedAgentRunFailure(confirmation, {
            category: 'conflict',
            retriable: false,
            ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
            compensation: 'manual-repair',
        });
        await settlePendingActionResourcesBestEffort({ confirmationId: confirmation.id, disposition: 'retain' });
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
    recordTrackedAgentRunFailure(confirmation, {
        category: failureCategory,
        retriable: false,
        ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
    });
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
