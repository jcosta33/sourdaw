import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
} from '#/modules/CrdtDocument/useCases';

import { type AgentRun, type AgentRunWorkLease } from '../../models/AgentRun';
import { updateChatMessage } from '../../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentWorkBudget, type AgentWorkBudgetEstimate } from '../agentWorkBudget';
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';
import { validateAgentRiskApproval } from '../validateAgentRiskApproval';

import { agentRunExecutionSettlement } from './agentRunExecutionSettlement';
import { confirmationTerminalSettlement } from './confirmationTerminalSettlement';
import { type CommandVerifiedBatchReceipt } from './confirmedBatchOutcomeSupport';
import { getRenderReceiptAdmissionFailure } from './getRenderReceiptAdmissionFailure';

type BeginConfirmedCommandExecutionInput = {
    confirmation: PendingAppActionConfirmation;
    priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null;
    recoveringPendingEffects: boolean;
};

type CommandBudgetReconciliation = { attemptId: string; estimates: AgentWorkBudgetEstimate[] };

type BeginConfirmedCommandExecutionResult =
    | {
          status: 'settled';
          result: ReturnType<typeof confirmationTerminalSettlement.failApprovalPreflight>;
      }
    | {
          status: 'ready';
          confirmation: PendingAppActionConfirmation;
          commandBatch: NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
          approvedBatchId: string;
          trackedWorkLease: AgentRunWorkLease | null;
          commandBudget: CommandBudgetReconciliation | null;
          priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null;
          recoveringPendingEffects: boolean;
      };

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

type ApprovalPreflightFailure = {
    reason: string;
    stale: boolean;
};

function getApprovalPreflightFailure(
    confirmation: PendingAppActionConfirmation,
    run: AgentRun | null
): ApprovalPreflightFailure | null {
    const approved = confirmation.approvalSnapshot;
    if (!approved.commandBatch) {
        return { reason: 'The confirmation has no approved command batch.', stale: false };
    }
    if (!approved.agentApproval) {
        return { reason: 'The command batch has no exact risk approval binding.', stale: false };
    }
    const currentRevision = projectRevisionMatchesLiveIgnoringCommandCheckpoint(confirmation.projectRevision)
        ? confirmation.projectRevision
        : captureProjectRevision();
    const validation = validateAgentRiskApproval({
        approval: approved.agentApproval,
        commandBatch: approved.commandBatch,
        currentRevision,
    });
    if (validation.status === 'invalid') {
        return { reason: validation.reason, stale: validation.stale };
    }
    const protectedAffectedIds = getProtectedAffectedIds(confirmation.actions, approved.protectedUnchanged);
    if (protectedAffectedIds.length > 0) {
        return {
            reason: `The executable action batch targets protected IDs: ${protectedAffectedIds.join(', ')}.`,
            stale: false,
        };
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
        return { reason: 'The executable action batch no longer matches the approved proposal.', stale: false };
    }

    const approvedProtectedAffectedIds = getProtectedAffectedIds(approved.actions, approved.protectedUnchanged);
    if (approvedProtectedAffectedIds.length > 0) {
        return {
            reason: `The approved action batch targets protected IDs: ${approvedProtectedAffectedIds.join(', ')}.`,
            stale: false,
        };
    }

    // Checked before any work is reserved or claimed, so the live side of the receipt's binding is
    // the run itself rather than a lease this flight has yet to take.
    return getRenderReceiptAdmissionFailure({
        runId: confirmation.runId,
        liveRun: run ? { runId: run.runId, cancellationGeneration: run.cancellation.generation } : null,
        actions: approved.actions,
    });
}

function settleApprovalPreflightRejection(
    confirmation: PendingAppActionConfirmation,
    failure: ApprovalPreflightFailure
): BeginConfirmedCommandExecutionResult {
    // Both preflight guards detect the same event — a confirmed proposal whose
    // project moved on after it was created — so whichever guard fires first
    // settles it identically: `invalidated` with the actionable instruction.
    // The guard's own reason stays on the internal result and in the logs.
    return {
        status: 'settled',
        result: failure.stale
            ? confirmationTerminalSettlement.invalidateForProjectChange(confirmation, failure.reason)
            : confirmationTerminalSettlement.failApprovalPreflight(confirmation, failure.reason, 'authorization'),
    };
}

export function beginConfirmedCommandExecution(
    input: BeginConfirmedCommandExecutionInput
): BeginConfirmedCommandExecutionResult {
    const { confirmation, priorVerifiedBatchReceipt, recoveringPendingEffects } = input;
    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;
    const run = agentRunLifecycle.get(confirmation.runId);
    const approvalPreflightFailure = hasPriorVerifiedBatchReceipt
        ? null
        : getApprovalPreflightFailure(confirmation, run);
    if (approvalPreflightFailure) {
        return settleApprovalPreflightRejection(confirmation, approvalPreflightFailure);
    }

    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        return {
            status: 'settled',
            result: confirmationTerminalSettlement.failApprovalPreflight(
                confirmation,
                'The confirmation has no approved command batch.',
                'authorization'
            ),
        };
    }
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        return {
            status: 'settled',
            result: confirmationTerminalSettlement.failApprovalPreflight(
                confirmation,
                parsedCommandBatch.reason,
                'schema'
            ),
        };
    }
    let trackedWorkLease: AgentRunWorkLease | null = null;
    let commandBudget: CommandBudgetReconciliation | null = null;
    if (run) {
        const attemptId = `${parsedCommandBatch.envelope.batchId}:1`;
        const budgetReservation = hasPriorVerifiedBatchReceipt
            ? null
            : agentWorkBudget.reserveCommandWork({
                  runId: confirmation.runId,
                  envelope: parsedCommandBatch.envelope,
                  attemptId,
              });
        if (budgetReservation?.status === 'hard-limit-reached') {
            return {
                status: 'settled',
                result: confirmationTerminalSettlement.failApprovalPreflight(
                    confirmation,
                    `The confirmed command work exceeds the user budget for ${budgetReservation.reason}.`,
                    'budget'
                ),
            };
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
                return {
                    status: 'settled',
                    result: confirmationTerminalSettlement.failApprovalPreflight(
                        confirmation,
                        `The confirmed command work could not be claimed: ${leaseResult.status}`,
                        'conflict'
                    ),
                };
            }
            trackedWorkLease = leaseResult.lease;
        }
        if (budgetReservation) {
            commandBudget = { attemptId, estimates: budgetReservation.estimates };
        }
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    agentRunExecutionSettlement.transitionToExecuting(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    return {
        status: 'ready',
        confirmation,
        commandBatch,
        approvedBatchId: parsedCommandBatch.envelope.batchId,
        trackedWorkLease,
        commandBudget,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    };
}
