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

import { projectSectionRenderConfirmation } from './projectSectionRenderConfirmation';

type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type RetryResult = { status: 'busy' | 'executed' } | { status: 'failed'; reason: string };
type RetryBudget = {
    attemptId: string;
    reservation: ReturnType<typeof agentRunLifecycle.reserveBudget>;
};

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

function failIncompleteRetry(confirmation: PendingAppActionConfirmation, reason: string): RetryResult {
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
    const refreshed = refreshConfirmationProjection(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'retryable',
        error: reason,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nThe project actions remain committed. Missing section renders are still incomplete: ${reason}. Retry missing renders without replaying the project actions.`,
    });
    return { status: 'failed', reason };
}

function reconcileRetryBudget(
    confirmation: PendingAppActionConfirmation,
    budget: RetryBudget | null,
    plannedJobCount: number
): void {
    if (budget?.reservation.status !== 'reserved') {
        return;
    }
    const remaining = projectSectionRenderConfirmation({ confirmation }).incompleteSectionRenders;
    const completedJobsCount = Math.max(0, plannedJobCount - (remaining?.missingJobIds.length ?? 0));
    agentRunLifecycle.reconcileBudgetAttempt({
        runId: confirmation.runId,
        attemptId: budget.attemptId,
        consumed: completedJobsCount,
        mode: 'final',
        provenance: 'versioned-estimate',
    });
}

function finishSuccessfulRetry(confirmation: PendingAppActionConfirmation): RetryResult {
    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    const refreshed = refreshConfirmationProjection(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'complete',
        error: undefined,
        content: `Applied after confirmation:\n\n${refreshed.projection.receipt}\n\nMissing section render artifacts completed without replaying project actions.`,
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
    try {
        await retryAgentProjectSectionRenders({ jobs: followUp.jobs, sourceRevision });
        const remaining = projectSectionRenderConfirmation({ confirmation }).incompleteSectionRenders;
        if (remaining) {
            throw new Error(`Section render jobs remain incomplete: ${remaining.missingJobIds.join(', ')}`);
        }
        completeDurableContinuation(durableReceipt);
    } catch (error) {
        return failIncompleteRetry(confirmation, error instanceof Error ? error.message : String(error));
    } finally {
        reconcileRetryBudget(confirmation, budget, followUp.jobs.length);
        setChatGenerating(false);
    }
    return finishSuccessfulRetry(confirmation);
}
