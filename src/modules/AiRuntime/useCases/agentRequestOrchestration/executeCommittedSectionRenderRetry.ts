import { logger } from '#/infra/logger/appLogger';
import { retryAgentProjectSectionRenders } from '#/modules/AudioRendering/useCases';
import { type createVerifiedBatchReceipt } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

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

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type RetryResult = { status: 'busy' | 'executed' } | { status: 'failed'; reason: string };
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

function completeDurableContinuation(receipt: CommandVerifiedBatchReceipt): void {
    agentRunLifecycle.completePendingEffectContinuation({
        runId: receipt.runId,
        batchId: receipt.batchId,
        receiptIdentity: getReceiptIdentity(receipt),
    });
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

function finishAlreadyComplete(
    confirmation: PendingAppActionConfirmation,
    durableReceipt: CommandVerifiedBatchReceipt
): RetryResult {
    try {
        completeDurableContinuation(durableReceipt);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
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
    persistenceWarning: string | null = null
): RetryResult {
    const refreshed = refreshConfirmationProjection(confirmation);
    const reviewSummary = formatSectionRenderReviewSummary(refreshed.projection.reviewRequiredSectionRenders);
    const reason = `Section render artifacts require manual review: ${reviewSummary}.`;
    const surfacedError = persistenceWarning ? `${reason}\n\n${persistenceWarning}` : reason;
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: surfacedError, status: 'failed' });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'executed',
        error: surfacedError,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'failed',
        error: surfacedError,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nThe project commands were not replayed. Retained section render artifacts require manual review: ${reviewSummary}.${persistenceWarning ? `\n\n_${persistenceWarning}_` : ''}`,
    });
    return { status: 'failed', reason };
}

function reconcileRetryBudget(
    confirmation: PendingAppActionConfirmation,
    budget: RetryBudget | null,
    attemptedJobs: ReadonlyArray<{ jobId: string }>
): void {
    if (budget?.reservation.status !== 'reserved') {
        return;
    }
    const performedJobIds = projectSectionRenderConfirmation({ confirmation }).performedSectionRenderJobIds;
    const completedJobsCount = attemptedJobs.filter(({ jobId }) => performedJobIds.has(jobId)).length;
    agentRunLifecycle.reconcileBudgetAttempt({
        runId: confirmation.runId,
        attemptId: budget.attemptId,
        consumed: completedJobsCount,
        mode: 'final',
        provenance: 'versioned-estimate',
    });
}

function reconcileRetryBudgetBestEffort(
    confirmation: PendingAppActionConfirmation,
    budget: RetryBudget | null,
    attemptedJobs: ReadonlyArray<{ jobId: string }>
): string | null {
    try {
        reconcileRetryBudget(confirmation, budget, attemptedJobs);
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
}): Promise<RetryResult> {
    const { confirmation, durableReceipt } = input;
    if (chatStore.value?.isGenerating === true) {
        return { status: 'busy' };
    }
    const initialProjection = projectSectionRenderConfirmation({ confirmation });
    const followUp = initialProjection.incompleteSectionRenders;
    if (!followUp) {
        if (initialProjection.reviewRequiredSectionRenders.length > 0) {
            return finishManualReview(confirmation);
        }
        return finishAlreadyComplete(confirmation, durableReceipt);
    }
    const sourceRevision = confirmation.followUpProjectRevision;
    if (!sourceRevision || captureProjectRevision() !== sourceRevision) {
        return failStaleRevision(confirmation);
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
    let manualReviewProjection: SectionRenderProjection | null = null;
    let budgetPersistenceWarning: string | null = null;
    try {
        try {
            await retryAgentProjectSectionRenders({ jobs: followUp.jobs, sourceRevision });
        } catch (error) {
            renderFailureReason = error instanceof Error ? error.message : String(error);
        }
        const liveProjection = projectSectionRenderConfirmation({ confirmation });
        if (liveProjection.incompleteSectionRenders) {
            if (renderFailureReason === undefined) {
                renderFailureReason = `Section render jobs remain incomplete: ${liveProjection.incompleteSectionRenders.missingJobIds.join(', ')}`;
            }
        } else if (liveProjection.reviewRequiredSectionRenders.length > 0) {
            manualReviewProjection = liveProjection;
        }
        if (renderFailureReason === undefined && !manualReviewProjection) {
            try {
                completeDurableContinuation(durableReceipt);
            } catch (error) {
                renderFailureReason = error instanceof Error ? error.message : String(error);
            }
        }
    } finally {
        try {
            budgetPersistenceWarning = reconcileRetryBudgetBestEffort(confirmation, budget, followUp.jobs);
        } finally {
            setChatGenerating(false);
        }
    }
    if (manualReviewProjection) {
        return finishManualReview(confirmation, budgetPersistenceWarning);
    }
    if (renderFailureReason !== undefined) {
        return failIncompleteRetry(confirmation, renderFailureReason, budgetPersistenceWarning);
    }
    return finishSuccessfulRetry(confirmation, budgetPersistenceWarning);
}
