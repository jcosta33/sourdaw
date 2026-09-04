import { logger } from '#/infra/logger/appLogger';
import {
    type compileVersionedCommandBatchEnvelope,
    type executeVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory, type AgentRunPendingEffect } from '../../models/AgentRun';
import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { updateChatMessage } from '../../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import { getVerifiedBatchReplayDisposition } from '../getVerifiedBatchReplayDisposition';
import { recoverPreparedStemImportResources } from '../recoverPreparedStemImportResources';

import { agentRunExecutionSettlement } from './agentRunExecutionSettlement';
import { confirmationTerminalSettlement } from './confirmationTerminalSettlement';
import {
    confirmedBatchOutcomeSupport,
    type CommittedEffectFailureResult,
    type CommittedFinalizationEvidenceFailureResult,
} from './confirmedBatchOutcomeSupport';
import { pendingActionResourceSettlement } from './pendingActionResourceSettlement';
import { requireSectionRenderManualRepair } from './requireSectionRenderManualRepair';
import { AGENT_RUN_PERSISTENCE_WARNING, settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';
import { settleConfirmedBatchOutcome } from './settleConfirmedBatchOutcome';
import { settleVerifiedBatchReplay } from './settleVerifiedBatchReplay';

import type { beginConfirmedCommandExecution } from './beginConfirmedCommandExecution';
import type { executeConfirmedCommandBatch } from './executeConfirmedCommandBatch';

type ConfirmedBatchResult = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
type ReadyConfirmedCommandExecution = Extract<ReturnType<typeof beginConfirmedCommandExecution>, { status: 'ready' }>;
type ConfirmedCommandExecutionFlight = Awaited<ReturnType<typeof executeConfirmedCommandBatch>>;
type ConfirmedCommandExecutionResult =
    | { status: 'executed' }
    | CommittedEffectFailureResult
    | CommittedFinalizationEvidenceFailureResult
    | { status: 'invalidated'; reason: string }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type SettleConfirmedCommandExecutionInput = {
    executionAdmission: ReadyConfirmedCommandExecution;
    executionFlight: ConfirmedCommandExecutionFlight;
};

const COMPLETED_BATCH_STATUSES = new Set([
    'committed',
    'committed-with-warning',
    'executed',
    'executed-with-warning',
    'no-op',
]);

function getApprovedSectionRenderCommandIds(
    confirmation: PendingAppActionConfirmation,
    commandBatch: ReturnType<typeof compileVersionedCommandBatchEnvelope>
): string[] {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid' || parsed.envelope.commands.length !== confirmation.approvalSnapshot.actions.length) {
        return [];
    }
    return confirmation.approvalSnapshot.actions.flatMap((action, index) => {
        const command = parsed.envelope.commands[index];
        if (action.type !== 'renderProjectSections' || command?.operation !== 'renderProjectSections') {
            return [];
        }
        const actionHash = getExactAgentActionHash({ operation: action.type, arguments: action.payload });
        const commandHash = getExactAgentActionHash({ operation: command.operation, arguments: command.arguments });
        return actionHash === commandHash ? [command.commandId] : [];
    });
}

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

function markPromotedPendingEffectsManualRepair(input: {
    runId: string;
    batchId: string;
    reason: string;
}): string | null {
    const continuation = agentRunLifecycle.getPendingEffectRecovery(input);
    if (!continuation || continuation.checkpoint !== 'durable') {
        return null;
    }
    try {
        agentRunLifecycle.requirePendingEffectManualRepair({
            ...input,
            preserveEffects: true,
        });
        return null;
    } catch (error) {
        logger.error(
            new Error('Promoted pending-effect continuation could not be marked manual repair', { cause: error })
        );
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function readDurableContinuationEffects(input: {
    runId: string;
    batchId: string;
    fallbackEffects: readonly AgentRunPendingEffect[];
}): readonly AgentRunPendingEffect[] {
    return agentRunLifecycle.getPendingEffectRecovery(input)?.effects ?? input.fallbackEffects;
}

export async function settleConfirmedCommandExecution(
    input: SettleConfirmedCommandExecutionInput
): Promise<ConfirmedCommandExecutionResult> {
    const { executionAdmission, executionFlight } = input;
    const {
        confirmation,
        commandBatch,
        approvedBatchId,
        trackedWorkLease,
        commandBudget,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    } = executionAdmission;
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
    const finalizationEvidenceUnavailable =
        batchCommittedProject && (committedProjectRevision === null || finalizationEvidenceFailure !== null);
    if (finalizationEvidenceUnavailable && !trackedLeaseSettlement.accepted) {
        const finalizationReason =
            finalizationEvidenceFailure ??
            'The committed command batch did not expose its exact project checkpoint revision.';
        const manualRepairPersistenceWarning =
            batchResult.receipt.pendingEffects.length > 0
                ? markPromotedPendingEffectsManualRepair({
                      runId: confirmation.runId,
                      batchId: batchResult.receipt.batchId,
                      reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
                  })
                : null;
        const reason = [
            finalizationReason,
            trackedLeaseSettlement.warning ?? AGENT_RUN_PERSISTENCE_WARNING,
            manualRepairPersistenceWarning,
        ]
            .filter(Boolean)
            .join(' ');
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `The project change is durably committed, but its finalization evidence arrived after the run lease was cancelled or replaced: ${reason} Do not replay these actions. Inspect the current project state before further automation.`,
        });
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        return confirmedBatchOutcomeSupport.createCommittedFinalizationEvidenceFailureResult(reason);
    }
    const budgetPersistenceWarning = commandBudget
        ? agentRunExecutionSettlement.reconcileCommandBudget({
              confirmation,
              ...commandBudget,
              actualRenderJobs: renderJobAttempts,
          })
        : null;
    if (finalizationEvidenceUnavailable) {
        const reason =
            finalizationEvidenceFailure ??
            'The committed command batch did not expose its exact project checkpoint revision.';
        const hasPendingEffects = batchResult.receipt.pendingEffects.length > 0;
        const hasPendingRenderEffects = batchResult.receipt.pendingEffects.some(
            (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
        );
        const approvedRenderCommandIds = getApprovedSectionRenderCommandIds(confirmation, commandBatch);
        const requiresRenderManualRepair = hasPendingRenderEffects || approvedRenderCommandIds.length > 0;
        const requiresRecoveryFollowUp = hasPendingEffects || requiresRenderManualRepair;
        const runPersistenceWarning = agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receipt: batchResult.receipt,
            actions: confirmation.actions,
            commandBatch,
            revertGroupId: group.groupId,
            ...(committedProjectRevision ? { committedRevision: committedProjectRevision } : {}),
        });
        const manualRepairPersistenceWarning = requiresRenderManualRepair
            ? requireSectionRenderManualRepair({
                  runId: confirmation.runId,
                  batchId: batchResult.receipt.batchId,
                  reason,
                  ...(approvedRenderCommandIds.length > 0
                      ? {
                            missingEffects: {
                                commandIds: approvedRenderCommandIds,
                                existingEffects: batchResult.receipt.pendingEffects,
                                receiptIdentity: `${batchResult.receipt.schemaVersion}:${batchResult.receipt.runId}:${batchResult.receipt.batchId}:${batchResult.receipt.outcome}`,
                                serializedBatch: commandBatch.serialized,
                                authority: commandBatch.authority,
                            },
                        }
                      : {}),
              })
            : null;
        const committedEffectFailureEffects = requiresRecoveryFollowUp
            ? readDurableContinuationEffects({
                  runId: confirmation.runId,
                  batchId: batchResult.receipt.batchId,
                  fallbackEffects: batchResult.receipt.pendingEffects,
              })
            : batchResult.receipt.pendingEffects;
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
        if (requiresRecoveryFollowUp) {
            updatePendingActionFollowUp({
                confirmationId: confirmation.id,
                error: userVisibleReason,
                projectRevision: null,
                status: 'failed',
            });
        }
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            ...(requiresRecoveryFollowUp ? { pendingActionFollowUpStatus: 'failed' } : {}),
            error: userVisibleReason,
            content: requiresRecoveryFollowUp
                ? `The project change is durably committed, but its finalization evidence is unavailable: ${userVisibleReason}. Do not replay these actions; use the retained pending-effect recovery guidance.`
                : `The project change is durably committed, but its finalization evidence is unavailable: ${userVisibleReason}. Do not replay these actions. Inspect the current project state before further automation.`,
        });
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        return requiresRecoveryFollowUp
            ? confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
                  batchResult.receipt,
                  userVisibleReason,
                  requiresRenderManualRepair ? 'manual-repair' : undefined,
                  committedEffectFailureEffects
              )
            : confirmedBatchOutcomeSupport.createCommittedFinalizationEvidenceFailureResult(userVisibleReason);
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
