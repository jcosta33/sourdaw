import {
    generateGroupId,
    isExecutableAppActionType,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunPhase, type AgentRunWorkTerminalState } from '../models/AgentRun';

import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentRunCancellation } from './cancelAgentRun';
import { executePlannedActions } from './executePlannedActions';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { notifyAiChange } from './notifyAiChange';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';

type ExecutePromptActionGroupInput = {
    actions: readonly AppAction[];
    prompt: string;
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
    runId: string;
    prepared: {
        commandBatch: Parameters<typeof issueAgentCommandApprovalBinding>[0]['commandBatch'];
        agentApproval: Parameters<typeof issueAgentCommandApprovalBinding>[0]['approval'] | null;
        requiresConfirmation: boolean;
    };
};

const TERMINAL_RUN_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function transitionRunIfLive(runId: string, phase: Extract<AgentRunPhase, 'failed' | 'partially-completed'>): void {
    const run = agentRunLifecycle.get(runId);
    if (run && !TERMINAL_RUN_PHASES.has(run.phase)) {
        agentRunLifecycle.transitionPhase({ runId, phase });
    }
}

function rejectPreparedBatch(input: { runId: string; batchId: string; reason: string }): never {
    const run = agentRunLifecycle.get(input.runId);
    if (run?.batches.some((batch) => batch.batchId === input.batchId)) {
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: input.batchId, status: 'failed' });
    }
    transitionRunIfLive(input.runId, 'failed');
    notifyAiChange(`Command not executed: ${input.reason}`, []);
    throw new Error(input.reason);
}

export async function executePromptActionGroup(input: ExecutePromptActionGroupInput): Promise<void> {
    const parsed = parseVersionedCommandBatchEnvelope(
        input.prepared.commandBatch.serialized,
        input.prepared.commandBatch.authority
    );
    if (parsed.status === 'invalid') {
        const trackedBatch = agentRunLifecycle.get(input.runId)?.batches.at(-1);
        rejectPreparedBatch({
            runId: input.runId,
            batchId: trackedBatch?.batchId ?? 'unavailable-batch',
            reason: parsed.reason,
        });
    }

    const { envelope } = parsed;
    const run = agentRunLifecycle.get(input.runId);
    const trackedBatch = run?.batches.find((batch) => batch.batchId === envelope.batchId);
    const preparedCommandIds = envelope.commands.map((command) => command.commandId);
    const batchIdentityMatches =
        run !== null &&
        envelope.runId === input.runId &&
        run.plan?.serializedBatchIdentity === envelope.idempotencyKey &&
        trackedBatch !== undefined &&
        trackedBatch.commandIds.length === preparedCommandIds.length &&
        trackedBatch.commandIds.every((commandId, index) => commandId === preparedCommandIds[index]);
    if (!batchIdentityMatches) {
        rejectPreparedBatch({
            runId: input.runId,
            batchId: envelope.batchId,
            reason: `Prepared command batch ${envelope.batchId} does not belong to admitted run ${input.runId}.`,
        });
    }

    if (!input.actions.every((action) => isExecutableAppActionType(action.type))) {
        const reason = 'one or more actions are not available through the approved command boundary.';
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
        transitionRunIfLive(input.runId, 'failed');
        notifyAiChange(`Command not executed: ${reason}`, []);
        return;
    }

    const receiptIdentity = `command:${input.runId}:${envelope.batchId}`;
    const leaseClaim = agentRunWorkLease.claim({
        runId: input.runId,
        workId: envelope.batchId,
        ownerKind: 'command',
        cleanupOwner: 'command-executor',
        idempotencyKey: envelope.idempotencyKey,
        receiptIdentity,
        idempotent: true,
        retriable: false,
    });
    if (leaseClaim.status !== 'claimed') {
        const reason = `Prepared command work could not be claimed: ${leaseClaim.status}`;
        if (!TERMINAL_RUN_PHASES.has(agentRunLifecycle.get(input.runId)?.phase ?? 'failed')) {
            agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
            transitionRunIfLive(input.runId, 'failed');
        }
        notifyAiChange(`Command not executed: ${reason}`, []);
        throw new Error(reason);
    }
    const commandLease = leaseClaim.lease;
    const settleCommand = (terminalState: AgentRunWorkTerminalState): boolean =>
        agentRunWorkLease.settle({
            runId: commandLease.runId,
            workId: commandLease.workId,
            leaseId: commandLease.leaseId,
            cancellationGeneration: commandLease.cancellationGeneration,
            idempotencyKey: commandLease.idempotencyKey,
            receiptIdentity: commandLease.receiptIdentity,
            terminalState,
        }).status === 'settled';
    const cancelCommand = (): Promise<unknown> =>
        agentRunCancellation.cancel({
            runId: input.runId,
            reason: 'Prompt command execution was cancelled before it committed.',
        });
    const onAbort = () => void cancelCommand();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    if (input.signal?.aborted) {
        await cancelCommand();
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        input.signal.removeEventListener('abort', onAbort);
        return;
    }

    const group = generateGroupId(input.prompt);
    let execution: Awaited<ReturnType<typeof executePlannedActions>>;
    try {
        const commandBatch = (() => {
            if (!input.prepared.agentApproval) {
                return input.prepared.commandBatch;
            }
            return {
                ...input.prepared.commandBatch,
                approvalBinding: issueAgentCommandApprovalBinding({
                    approval: input.prepared.agentApproval,
                    commandBatch: input.prepared.commandBatch,
                }),
            };
        })();
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'executing' });
        agentRunLifecycle.transitionPhase({
            runId: input.runId,
            phase: 'executing',
            revision: input.projectRevision,
        });
        execution = await executePlannedActions({ ...input, group, commandBatch });
    } catch (error) {
        const reason = getErrorMessage(error);
        if (settleCommand('failed')) {
            agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
            transitionRunIfLive(input.runId, 'failed');
        }
        notifyAiChange(`Command not executed: ${reason}`, []);
        throw error;
    } finally {
        input.signal?.removeEventListener('abort', onAbort);
    }

    if (execution.status === 'committed' || execution.status === 'executed') {
        if (!execution.receipt) {
            const reason = 'Command execution completed without an exact verified receipt.';
            if (settleCommand('failed')) {
                agentRunLifecycle.updateBatchStatus({
                    runId: input.runId,
                    batchId: envelope.batchId,
                    status: 'failed',
                });
                transitionRunIfLive(input.runId, 'partially-completed');
            }
            notifyAiChange(`Command outcome is uncertain: ${reason} Inspect the project before retrying.`, []);
            return;
        }
        if (execution.receipt.runId !== input.runId || execution.receipt.batchId !== envelope.batchId) {
            const reason = 'Command execution returned a receipt for a different admitted batch.';
            if (settleCommand('failed')) {
                agentRunLifecycle.updateBatchStatus({
                    runId: input.runId,
                    batchId: envelope.batchId,
                    status: 'failed',
                });
                transitionRunIfLive(input.runId, 'partially-completed');
            }
            notifyAiChange(`Command outcome is uncertain: ${reason} Inspect the project before retrying.`, []);
            return;
        }
        const settlementAccepted = settleCommand('completed');
        recordAgentRunReceiptSaga({
            runId: input.runId,
            receipt: execution.receipt,
            actions: input.actions,
            committedRevision: captureProjectRevision(),
            completesRun: settlementAccepted,
        });
        return;
    }

    if (execution.status === 'cancelled') {
        await cancelCommand();
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        return;
    }

    if (execution.status === 'invalidated' || execution.status === 'failed') {
        if (settleCommand('failed')) {
            agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
            transitionRunIfLive(input.runId, 'failed');
        }
        notifyAiChange(`Command not executed: ${execution.reason}`, []);
        return;
    }

    if (execution.status === 'ambiguous') {
        if (settleCommand('failed')) {
            agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
            transitionRunIfLive(input.runId, 'partially-completed');
        }
        notifyAiChange(`Command outcome is uncertain: ${execution.reason}. Inspect the project before retrying.`, []);
        return;
    }

    if (settleCommand('completed')) {
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'no-op' });
        agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'completed' });
    }
    notifyAiChange('No project changes were needed.', []);
}
