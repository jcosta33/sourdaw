import { logger } from '#/infra/logger/appLogger';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type AgentRunErrorCategory, type AgentRunErrorRemediation } from '../../models/AgentRun';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget, type AgentWorkBudgetEstimate } from '../agentWorkBudget';

import { AGENT_RUN_PERSISTENCE_WARNING } from './settleAgentRunWorkLeaseSafely';

function lifecyclePersistenceWarning(error: unknown): string {
    logger.error(new Error('Agent run lifecycle update failed', { cause: error }));
    return AGENT_RUN_PERSISTENCE_WARNING;
}

function transitionToExecuting(confirmation: PendingAppActionConfirmation): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
        return null;
    } catch (error) {
        return lifecyclePersistenceWarning(error);
    }
}

function reconcileCommandBudget(input: {
    confirmation: PendingAppActionConfirmation;
    attemptId: string;
    estimates: AgentWorkBudgetEstimate[];
    actualRenderJobs: number;
}): string | null {
    if (!agentRunLifecycle.get(input.confirmation.runId)) {
        return null;
    }
    try {
        agentWorkBudget.reconcileCommandWork({
            runId: input.confirmation.runId,
            attemptId: input.attemptId,
            estimates: input.estimates,
            actualRenderJobs: input.actualRenderJobs,
        });
        return null;
    } catch (error) {
        return lifecyclePersistenceWarning(error);
    }
}

function completeNoOp(confirmation: PendingAppActionConfirmation, workId?: string): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        if (workId) {
            agentRunLifecycle.updateBatchStatus({ runId: confirmation.runId, batchId: workId, status: 'no-op' });
        }
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
        return null;
    } catch (error) {
        return lifecyclePersistenceWarning(error);
    }
}

function cancelBeforeCommit(confirmation: PendingAppActionConfirmation): string | null {
    return cancel(confirmation, 'User cancelled before the command committed.');
}

function cancelFromVerifiedReceipt(confirmation: PendingAppActionConfirmation): string | null {
    return cancel(confirmation, 'The verified command receipt records cancellation.');
}

function cancel(confirmation: PendingAppActionConfirmation, reason: string): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        agentRunLifecycle.cancel({ runId: confirmation.runId, reason });
        return null;
    } catch (error) {
        return lifecyclePersistenceWarning(error);
    }
}

type AgentRunFailureInput = {
    category: AgentRunErrorCategory;
    retriable: boolean;
    workId?: string;
    receiptIdentity?: string;
    compensation?: AgentRunErrorRemediation['compensation'];
    knownDomain?: boolean;
};

function recordTerminalFailure(
    confirmation: PendingAppActionConfirmation,
    input: AgentRunFailureInput,
    includeCommandBatchWorkId: boolean
): string | null {
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
    } else if (includeCommandBatchWorkId && batchWorkId) {
        workIds.push(batchWorkId);
    }
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
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
        return null;
    } catch (error) {
        return lifecyclePersistenceWarning(error);
    }
}

function recordFailure(confirmation: PendingAppActionConfirmation, input: AgentRunFailureInput): string | null {
    return recordTerminalFailure(confirmation, input, true);
}

function recordPostCommitRecoveryFailure(
    confirmation: PendingAppActionConfirmation,
    input: Omit<AgentRunFailureInput, 'workId' | 'compensation'>
): string | null {
    return recordTerminalFailure(confirmation, input, false);
}

export const agentRunExecutionSettlement = {
    cancelBeforeCommit,
    cancelFromVerifiedReceipt,
    completeNoOp,
    recordFailure,
    recordPostCommitRecoveryFailure,
    reconcileCommandBudget,
    transitionToExecuting,
};
