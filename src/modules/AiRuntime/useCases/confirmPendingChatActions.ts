import { logger } from '#/infra/logger/appLogger';
import {
    type executeVersionedCommandBatchEnvelope,
    type refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { updateChatMessage } from '../stores/chatStore';
import {
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../stores/pendingActionConfirmationStore';

import { agentRunExecutionSettlement } from './agentRequestOrchestration/agentRunExecutionSettlement';
import { beginConfirmedCommandExecution } from './agentRequestOrchestration/beginConfirmedCommandExecution';
import { confirmationTerminalSettlement } from './agentRequestOrchestration/confirmationTerminalSettlement';
import {
    confirmedBatchOutcomeSupport,
    type CommittedEffectFailureResult,
} from './agentRequestOrchestration/confirmedBatchOutcomeSupport';
import { executeCommittedSectionRenderRetry } from './agentRequestOrchestration/executeCommittedSectionRenderRetry';
import { executeConfirmedCommandBatch } from './agentRequestOrchestration/executeConfirmedCommandBatch';
import { pendingActionResourceSettlement } from './agentRequestOrchestration/pendingActionResourceSettlement';
import { requireSectionRenderManualRepair } from './agentRequestOrchestration/requireSectionRenderManualRepair';
import { confirmationAdmission } from './agentRequestOrchestration/resolveConfirmationAdmission';
import {
    AGENT_RUN_PERSISTENCE_WARNING,
    settleAgentRunWorkLeaseSafely,
} from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { settleConfirmedBatchOutcome } from './agentRequestOrchestration/settleConfirmedBatchOutcome';
import { settleVerifiedBatchReplay } from './agentRequestOrchestration/settleVerifiedBatchReplay';
import { agentRunWorkLease } from './agentRunWorkLease';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type ConfirmedBatchResult = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;

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

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const admission = confirmationAdmission.consumeConfirmationAdmission(
        await confirmationAdmission.resolveConfirmationAdmission(input)
    );
    if (admission.status === 'handled') {
        return admission.result;
    }
    if (admission.status === 'render-retry') {
        return executeCommittedSectionRenderRetry({
            confirmation: admission.confirmation,
            durableReceipt: admission.durableReceipt,
            commandBatch: admission.commandBatch,
        });
    }
    const executionAdmission = beginConfirmedCommandExecution(admission);
    if (executionAdmission.status === 'settled') {
        return executionAdmission.result;
    }
    const {
        confirmation,
        commandBatch,
        approvedBatchId,
        trackedWorkLease,
        commandBudget,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    } = executionAdmission;
    const executionFlight = await executeConfirmedCommandBatch({
        confirmation,
        commandBatch,
        approvedBatchId,
        trackedWorkLease,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    });
    if (executionFlight.status === 'recovery-failed') {
        return executionFlight.result;
    }
    if (executionFlight.status === 'failed') {
        const error = executionFlight.error;
        const reason = error instanceof Error ? error.message : String(error);
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
            agentRunExecutionSettlement.recordFailure(confirmation, {
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
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
        return { status: 'failed', reason };
    }

    const {
        batchResult,
        group,
        committedProjectRevision,
        finalizationEvidenceFailure,
        canRebindSectionRenderArtifacts,
        isProjectMutationAuthorized,
        renderJobAttempts,
        cancellationTriggeredByInvalidation,
        abortSignal,
    } = executionFlight;
    const batchCommittedProject = batchResult.status === 'committed' || batchResult.status === 'committed-with-warning';
    const budgetPersistenceWarning = commandBudget
        ? agentRunExecutionSettlement.reconcileCommandBudget({
              confirmation,
              ...commandBudget,
              actualRenderJobs: renderJobAttempts,
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
    if (batchCommittedProject && (committedProjectRevision === null || finalizationEvidenceFailure !== null)) {
        const reason =
            finalizationEvidenceFailure ??
            'The committed command batch did not expose its exact project checkpoint revision.';
        const runPersistenceWarning = agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receipt: batchResult.receipt,
            actions: confirmation.actions,
            commandBatch,
            revertGroupId: group.groupId,
            ...(committedProjectRevision ? { committedRevision: committedProjectRevision } : {}),
        });
        const manualRepairPersistenceWarning = batchResult.receipt.pendingEffects.some(
            (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
        )
            ? requireSectionRenderManualRepair({
                  runId: confirmation.runId,
                  batchId: batchResult.receipt.batchId,
                  reason,
              })
            : null;
        const userVisibleReason = [
            reason,
            runPersistenceWarning,
            manualRepairPersistenceWarning,
            budgetPersistenceWarning,
            trackedLeaseSettlement.warning,
        ]
            .filter(Boolean)
            .join(' ');
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: userVisibleReason,
        });
        updatePendingActionFollowUp({
            confirmationId: confirmation.id,
            error: userVisibleReason,
            projectRevision: null,
            status: 'failed',
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: userVisibleReason,
            content: `The project change is durably committed, but its finalization evidence is unavailable: ${userVisibleReason}. Do not replay these actions; use the retained manual-repair guidance.`,
        });
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(batchResult.receipt, userVisibleReason);
    }
    const settledProjectRevision = committedProjectRevision ?? confirmation.projectRevision;

    if (batchResult.status === 'idempotent-replay') {
        return settleVerifiedBatchReplay({
            confirmation,
            approvedBatchId,
            receipt: batchResult.receipt,
            recoveredExternalEffects:
                'recoveredExternalEffects' in batchResult && batchResult.recoveredExternalEffects === true,
            leaseSettlement: trackedLeaseSettlement,
        });
    }

    const batchFailedBeforeCommit =
        batchResult.status === 'rejected' || batchResult.status === 'conflicted' || batchResult.status === 'failed';
    if (!recoveringPendingEffects && batchFailedBeforeCommit && !isProjectMutationAuthorized()) {
        return confirmationTerminalSettlement.invalidateForProjectChange(confirmation);
    }

    if (batchResult.status === 'cancelled') {
        if (abortSignal.aborted && !cancellationTriggeredByInvalidation) {
            return confirmationTerminalSettlement.cancelAcceptedConfirmation(confirmation);
        }
        return confirmationTerminalSettlement.invalidateForProjectChange(confirmation);
    }

    if (
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'executed' ||
        batchResult.status === 'executed-with-warning'
    ) {
        return settleConfirmedBatchOutcome({
            confirmation,
            batchResult,
            groupId: group.groupId,
            committedProjectRevision: settledProjectRevision,
            trackedLeaseSettlement,
            budgetPersistenceWarning,
            canRebindSectionRenderArtifacts,
            retainCommittedPendingActionResources: pendingActionResourceSettlement.retainCommitted,
        });
    }

    if (batchResult.status === 'no-op') {
        if (!trackedLeaseSettlement.accepted) {
            const warning = trackedLeaseSettlement.warning ?? AGENT_RUN_PERSISTENCE_WARNING;
            await pendingActionResourceSettlement.settleBestEffort({
                confirmationId: confirmation.id,
                disposition: 'discard',
            });
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
        agentRunExecutionSettlement.completeNoOp(confirmation, trackedWorkLease?.workId);
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
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
            await pendingActionResourceSettlement.retainCommitted(confirmation.id);
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
            return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
                priorVerifiedBatchReceipt,
                batchResult.reason
            );
        }
        if (trackedLeaseSettlement.accepted) {
            agentRunExecutionSettlement.recordFailure(confirmation, {
                category: 'conflict',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                compensation: 'manual-repair',
            });
        }
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'retain',
        });
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
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
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
        return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
            priorVerifiedBatchReceipt,
            batchResult.reason
        );
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
        agentRunExecutionSettlement.recordFailure(confirmation, {
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
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason: batchResult.reason };
}
