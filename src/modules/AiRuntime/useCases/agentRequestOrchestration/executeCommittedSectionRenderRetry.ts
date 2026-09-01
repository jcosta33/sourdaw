import { logger } from '#/infra/logger/appLogger';
import { getSectionRenderFollowUpFailure, retryAgentProjectSectionRenders } from '#/modules/AudioRendering/useCases';
import {
    canExecuteCommandBatchEffects,
    finalizeRecoveredCommandBatchEffects,
    type createVerifiedBatchReceipt,
} from '#/modules/Command/useCases';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';

import { chatStore, setChatGenerating, updateChatMessage } from '../../stores/chatStore';
import {
    getPendingActionConfirmation,
    replacePendingActionExecutions,
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { formatSectionRenderReviewSummary } from './formatSectionRenderReviewSummary';
import { projectSectionRenderConfirmation } from './projectSectionRenderConfirmation';
import { requireSectionRenderManualRepair } from './requireSectionRenderManualRepair';

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type RetryResult = { status: 'busy' | 'executed' } | { status: 'failed'; reason: string };
type FinalizeCommandReceiptResult = Awaited<ReturnType<typeof finalizeRecoveredCommandBatchEffects>>;
type RetryBudget = {
    attemptId: string;
    reservation: ReturnType<typeof agentRunLifecycle.reserveBudget>;
};
type SectionRenderProjection = ReturnType<typeof projectSectionRenderConfirmation>;

const RENDER_RETRY_BUDGET_PERSISTENCE_WARNING =
    'Agent render retry budget reconciliation could not be persisted. The render outcome remains authoritative; review durable run budget state before retrying.';

function getReceiptIdentity(receipt: CommandVerifiedBatchReceipt): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function retainFinalizedContinuationCrashWindow(receipt: CommandVerifiedBatchReceipt): void {
    const continuation = agentRunLifecycle
        .get(receipt.runId)
        ?.pendingEffectContinuations.find((candidate) => candidate.batchId === receipt.batchId);
    if (!continuation) {
        return;
    }
    const { sourceRevision: _sourceRevision, ...crashWindowContinuation } = continuation;
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: receipt.runId,
        continuation: {
            ...crashWindowContinuation,
            lastError: crashWindowContinuation.lastError,
            recovery: 'manual-repair',
        },
    });
}

function completeDurableContinuation(receipt: CommandVerifiedBatchReceipt): void {
    try {
        agentRunLifecycle.completePendingEffectContinuation({
            runId: receipt.runId,
            batchId: receipt.batchId,
            receiptIdentity: getReceiptIdentity(receipt),
        });
    } catch (error) {
        retainFinalizedContinuationCrashWindow(receipt);
        throw error;
    }
}

function getApprovedRenderEvidenceFailure(confirmation: PendingAppActionConfirmation): string | null {
    const incomplete = projectSectionRenderConfirmation({ confirmation }).incompleteSectionRenders;
    return incomplete
        ? `Approved section render artifacts changed before durable retry completion: ${incomplete.missingJobIds.join(', ')}`
        : null;
}

async function finalizeCommandReceipt(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt,
    commandBatch: Pick<Parameters<typeof finalizeRecoveredCommandBatchEffects>[0], 'authority' | 'serialized'>
): Promise<FinalizeCommandReceiptResult> {
    const expectedProjectRevision = confirmation.followUpProjectRevision;
    if (!expectedProjectRevision) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'The committed render receipt authority is unavailable',
        };
    }
    const result = await finalizeRecoveredCommandBatchEffects({
        ...commandBatch,
        pendingReceipt: receipt,
        expectedProjectRevision,
        validateRecoveredEffects: () => getApprovedRenderEvidenceFailure(confirmation),
    });
    return result;
}

function refreshConfirmationProjection(confirmation: PendingAppActionConfirmation) {
    const current = getPendingActionConfirmation(confirmation.id) ?? confirmation;
    const projection = projectSectionRenderConfirmation({ confirmation: current });
    const refreshed =
        replacePendingActionExecutions({ confirmationId: current.id, executions: projection.executions }) ?? current;
    return {
        confirmation: refreshed,
        projection: projectSectionRenderConfirmation({ confirmation: refreshed }),
    };
}

async function finishAlreadyComplete(
    confirmation: PendingAppActionConfirmation,
    durableReceipt: CommandVerifiedBatchReceipt,
    commandBatch: Pick<Parameters<typeof finalizeRecoveredCommandBatchEffects>[0], 'authority' | 'serialized'>
): Promise<RetryResult> {
    try {
        const result = await finalizeCommandReceipt(confirmation, durableReceipt, commandBatch);
        if (result.status === 'failed') {
            return result.disposition === 'manual-repair'
                ? finishTerminalFinalizationManualRepair(confirmation, durableReceipt.batchId, result.reason)
                : failAlreadyCompleteFinalization(confirmation, result.reason);
        }
        completeDurableContinuation(result.receipt);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failAlreadyCompleteFinalization(confirmation, reason);
    }
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    const refreshed = refreshConfirmationProjection(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'complete',
        error: undefined,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nAll section render artifacts are complete; project actions were not replayed.`,
    });
    return { status: 'executed' };
}

function failAlreadyCompleteFinalization(confirmation: PendingAppActionConfirmation, reason: string): RetryResult {
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'failed', error: reason });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        pendingActionFollowUpStatus: 'retryable',
        error: reason,
        content: `All expected section render artifacts are present, but durable retry completion could not be recorded: ${reason}. Project actions were not replayed.`,
    });
    return { status: 'failed', reason };
}

function failStaleRevision(confirmation: PendingAppActionConfirmation): RetryResult {
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

function failUnavailableExecutionAuthority(confirmation: PendingAppActionConfirmation): RetryResult {
    const reason = 'Only the authoritative collaboration host can retry committed section renders.';
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'failed', error: reason });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        pendingActionFollowUpStatus: 'retryable',
        error: reason,
        content: `The project commands remain committed, but this collaboration peer cannot retry the missing section renders: ${reason}`,
    });
    return { status: 'failed', reason };
}

function reserveRetryBudget(confirmation: PendingAppActionConfirmation, jobCount: number): RetryBudget | null {
    const trackedRun = agentRunLifecycle.get(confirmation.runId);
    if (!trackedRun) {
        return null;
    }
    const retryPrefix = `render-retry:${confirmation.id}:`;
    const attemptId = `${retryPrefix}${trackedRun.budgetAttempts.filter((attempt) => attempt.attemptId.startsWith(retryPrefix)).length + 1}`;
    const reservation = agentRunLifecycle.reserveBudget({
        runId: confirmation.runId,
        attemptId,
        category: 'maxRenderJobs',
        estimate: jobCount,
        provenance: 'versioned-estimate',
    });
    return { attemptId, reservation };
}

function failHardBudgetLimit(confirmation: PendingAppActionConfirmation, budget: RetryBudget): RetryResult | null {
    if (budget.reservation.status !== 'hard-limit-reached') {
        return null;
    }
    const reason = `The missing section renders exceed the user budget for ${budget.reservation.reason}.`;
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

function failIncompleteRetry(
    confirmation: PendingAppActionConfirmation,
    reason: string,
    persistenceWarning: string | null
): RetryResult {
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
    const refreshed = refreshConfirmationProjection(confirmation);
    const reviewSummary = formatSectionRenderReviewSummary(refreshed.projection.reviewRequiredSectionRenders);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'retryable',
        error: reason,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nThe project actions remain committed. Missing section renders are still incomplete: ${reason}. Retry missing renders without replaying the project actions.${reviewSummary ? ` Retained render artifacts still require manual review: ${reviewSummary}.` : ''}${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}`,
    });
    return { status: 'failed', reason };
}

function finishManualReview(
    confirmation: PendingAppActionConfirmation,
    batchId: string,
    persistenceWarning: string | null = null
): RetryResult {
    const refreshed = refreshConfirmationProjection(confirmation);
    const reviewSummary = formatSectionRenderReviewSummary(refreshed.projection.reviewRequiredSectionRenders);
    const reason = `Section render artifacts require manual review: ${reviewSummary}.`;
    const manualRepairPersistenceWarning = requireSectionRenderManualRepair({
        runId: confirmation.runId,
        batchId,
        reason,
    });
    const surfacedError = [reason, persistenceWarning, manualRepairPersistenceWarning].filter(Boolean).join('\n\n');
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: surfacedError, status: 'failed' });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: manualRepairPersistenceWarning ? 'failed' : 'executed',
        error: surfacedError,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: manualRepairPersistenceWarning ? 'failed' : 'executed',
        pendingActionFollowUpStatus: 'failed',
        error: surfacedError,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nThe project commands were not replayed. Retained section render artifacts require manual review: ${reviewSummary}.${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}${manualRepairPersistenceWarning ? `\n\n${manualRepairPersistenceWarning}` : ''}`,
    });
    return { status: 'failed', reason };
}

function finishRetentionCapacityManualRepair(
    confirmation: PendingAppActionConfirmation,
    batchId: string,
    reason: string,
    persistenceWarning: string | null = null
): RetryResult {
    const manualRepairPersistenceWarning = requireSectionRenderManualRepair({
        runId: confirmation.runId,
        batchId,
        reason,
    });
    const surfacedError = [reason, persistenceWarning, manualRepairPersistenceWarning].filter(Boolean).join('\n\n');
    updatePendingActionFollowUp({
        confirmationId: confirmation.id,
        error: surfacedError,
        failureKind: 'retention-capacity',
        status: 'failed',
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: manualRepairPersistenceWarning ? 'failed' : 'executed',
        error: surfacedError,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: manualRepairPersistenceWarning ? 'failed' : 'executed',
        pendingActionFollowUpStatus: 'failed',
        error: surfacedError,
        content: `Applied after confirmation:\n\nThe project commands were not replayed. The approved section render artifacts cannot coexist within session retention capacity and require manual repair: ${reason}.${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}${manualRepairPersistenceWarning ? `\n\n${manualRepairPersistenceWarning}` : ''}`,
    });
    return { status: 'failed', reason };
}

function finishTerminalFinalizationManualRepair(
    confirmation: PendingAppActionConfirmation,
    batchId: string,
    reason: string,
    persistenceWarning: string | null = null
): RetryResult {
    const manualRepairPersistenceWarning = requireSectionRenderManualRepair({
        runId: confirmation.runId,
        batchId,
        reason,
    });
    const surfacedError = [reason, persistenceWarning, manualRepairPersistenceWarning].filter(Boolean).join('\n\n');
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: surfacedError, status: 'failed' });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: manualRepairPersistenceWarning ? 'failed' : 'executed',
        error: surfacedError,
    });
    const refreshed = refreshConfirmationProjection(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: manualRepairPersistenceWarning ? 'failed' : 'executed',
        pendingActionFollowUpStatus: 'failed',
        error: surfacedError,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nThe project commands were not replayed. The durable section-render receipt cannot be finalized safely and requires manual repair: ${reason}.${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}${manualRepairPersistenceWarning ? `\n\n${manualRepairPersistenceWarning}` : ''}`,
    });
    return { status: 'failed', reason };
}

function reconcileRetryBudget(
    confirmation: PendingAppActionConfirmation,
    budget: RetryBudget | null,
    attemptedRenderJobIds: ReadonlySet<string>
): void {
    if (budget?.reservation.status !== 'reserved') {
        return;
    }
    agentRunLifecycle.reconcileBudgetAttempt({
        runId: confirmation.runId,
        attemptId: budget.attemptId,
        consumed: attemptedRenderJobIds.size,
        mode: 'final',
        provenance: 'versioned-estimate',
    });
}

function reconcileRetryBudgetBestEffort(
    confirmation: PendingAppActionConfirmation,
    budget: RetryBudget | null,
    attemptedRenderJobIds: ReadonlySet<string>
): string | null {
    try {
        reconcileRetryBudget(confirmation, budget, attemptedRenderJobIds);
        return null;
    } catch (error) {
        logger.error(new Error(RENDER_RETRY_BUDGET_PERSISTENCE_WARNING, { cause: error }));
        return RENDER_RETRY_BUDGET_PERSISTENCE_WARNING;
    }
}

function finishSuccessfulRetry(
    confirmation: PendingAppActionConfirmation,
    persistenceWarning: string | null
): RetryResult {
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    const refreshed = refreshConfirmationProjection(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'complete',
        error: persistenceWarning ?? undefined,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nMissing section render artifacts completed without replaying project actions.${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}`,
    });
    return { status: 'executed' };
}

export async function executeCommittedSectionRenderRetry(input: {
    confirmation: PendingAppActionConfirmation;
    durableReceipt: CommandVerifiedBatchReceipt;
    commandBatch: Pick<Parameters<typeof finalizeRecoveredCommandBatchEffects>[0], 'authority' | 'serialized'>;
}): Promise<RetryResult> {
    const { confirmation, durableReceipt } = input;
    if (chatStore.value?.isGenerating === true) {
        return { status: 'busy' };
    }
    const initialProjection = projectSectionRenderConfirmation({ confirmation });
    const followUp = initialProjection.incompleteSectionRenders;
    if (!followUp) {
        if (initialProjection.reviewRequiredSectionRenders.length > 0) {
            return finishManualReview(confirmation, durableReceipt.batchId);
        }
        return finishAlreadyComplete(confirmation, durableReceipt, input.commandBatch);
    }
    const sourceRevision = confirmation.followUpProjectRevision;
    if (!sourceRevision || !projectRevisionMatchesLiveIgnoringCommandCheckpoint(sourceRevision)) {
        return failStaleRevision(confirmation);
    }
    if (!canExecuteCommandBatchEffects()) {
        return failUnavailableExecutionAuthority(confirmation);
    }
    const budget = reserveRetryBudget(confirmation, followUp.jobs.length);
    if (budget) {
        const hardLimitFailure = failHardBudgetLimit(confirmation, budget);
        if (hardLimitFailure) {
            return hardLimitFailure;
        }
    }

    updatePendingActionFollowUp({ confirmationId: confirmation.id, status: 'running' });
    updateChatMessage(confirmation.assistantMessageId, { pendingActionFollowUpStatus: 'running' });
    setChatGenerating(true);
    let renderFailureReason: string | undefined;
    let retentionCapacityFailureReason: string | null = null;
    let retentionCapacityManualRepair: RetryResult | null = null;
    let manualReviewProjection: SectionRenderProjection | null = null;
    let terminalFinalizationReason: string | null = null;
    let budgetPersistenceWarning: string | null = null;
    const attemptedRenderJobIds = new Set<string>();
    try {
        try {
            await retryAgentProjectSectionRenders({
                approvedJobs: initialProjection.approvedSectionRenderJobs,
                jobs: followUp.jobs,
                sourceRevision,
                onRenderAttempt: (job) => attemptedRenderJobIds.add(job.jobId),
                validateArtifactAttachment: () =>
                    canExecuteCommandBatchEffects()
                        ? null
                        : 'Only the authoritative collaboration host can attach section render artifacts.',
            });
        } catch (error) {
            const followUpFailure = getSectionRenderFollowUpFailure(error);
            if (followUpFailure?.failureKind === 'retention-capacity') {
                retentionCapacityFailureReason = error instanceof Error ? error.message : String(error);
            } else {
                renderFailureReason = error instanceof Error ? error.message : String(error);
            }
        }
        const liveProjection = projectSectionRenderConfirmation({ confirmation });
        if (!retentionCapacityFailureReason && liveProjection.incompleteSectionRenders) {
            if (renderFailureReason === undefined) {
                renderFailureReason = `Section render jobs remain incomplete: ${liveProjection.incompleteSectionRenders.missingJobIds.join(', ')}`;
            }
        } else if (liveProjection.reviewRequiredSectionRenders.length > 0) {
            manualReviewProjection = liveProjection;
        }
        if (renderFailureReason === undefined && !retentionCapacityFailureReason && !manualReviewProjection) {
            try {
                const result = await finalizeCommandReceipt(confirmation, durableReceipt, input.commandBatch);
                if (result.status === 'failed') {
                    if (result.disposition === 'manual-repair') {
                        terminalFinalizationReason = result.reason;
                    } else {
                        renderFailureReason = result.reason;
                    }
                } else {
                    completeDurableContinuation(result.receipt);
                }
            } catch (error) {
                renderFailureReason = error instanceof Error ? error.message : String(error);
            }
        }
    } finally {
        try {
            if (retentionCapacityFailureReason) {
                retentionCapacityManualRepair = finishRetentionCapacityManualRepair(
                    confirmation,
                    durableReceipt.batchId,
                    retentionCapacityFailureReason
                );
            }
            budgetPersistenceWarning = reconcileRetryBudgetBestEffort(confirmation, budget, attemptedRenderJobIds);
        } finally {
            setChatGenerating(false);
        }
    }
    if (retentionCapacityManualRepair) {
        return retentionCapacityManualRepair;
    }
    if (manualReviewProjection) {
        return finishManualReview(confirmation, durableReceipt.batchId, budgetPersistenceWarning);
    }
    if (terminalFinalizationReason) {
        return finishTerminalFinalizationManualRepair(
            confirmation,
            durableReceipt.batchId,
            terminalFinalizationReason,
            budgetPersistenceWarning
        );
    }
    if (renderFailureReason !== undefined) {
        return failIncompleteRetry(confirmation, renderFailureReason, budgetPersistenceWarning);
    }
    return finishSuccessfulRetry(confirmation, budgetPersistenceWarning);
}
