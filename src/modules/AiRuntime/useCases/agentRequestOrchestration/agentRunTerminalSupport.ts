import { logger } from '#/infra/logger/appLogger';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type AgentRunErrorCategory, type AgentRunErrorRemediation } from '../../models/AgentRun';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { AGENT_RUN_PERSISTENCE_WARNING } from './settleAgentRunWorkLeaseSafely';

function update(confirmation: PendingAppActionConfirmation, operation: () => void): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        operation();
        return null;
    } catch (error) {
        logger.error(new Error('Agent run lifecycle update failed', { cause: error }));
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function recordFailure(
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
    update(confirmation, () => {
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

export const agentRunTerminalSupport = { recordFailure, update };
