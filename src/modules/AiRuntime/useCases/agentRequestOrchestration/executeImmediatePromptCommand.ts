import { logger } from '#/infra/logger/appLogger';

import { updateChatMessage } from '../../stores/chatStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { executePlannedActions } from '../executePlannedActions';
import { getProjectCommitFinalizationWarning } from '../getProjectCommitFinalizationWarning';
import { recordAgentRunReceiptSaga } from '../recordAgentRunReceiptSaga';

import { AGENT_RUN_PERSISTENCE_WARNING, settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';

import type { generateGroupId, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

type ExecuteInput = Parameters<typeof executePlannedActions>[0];
type CommandExecutionInput = Extract<ExecuteInput, { commandBatch: unknown }>;
type ParsedCommandBatch = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>;
type AgentApplyReceipt = Extract<
    Awaited<ReturnType<typeof executePlannedActions>>,
    { status: 'committed' | 'executed' }
>['receipt'];

type ExecuteImmediatePromptCommandInput = {
    runId: string;
    prompt: string;
    actions: ExecuteInput['actions'];
    assistantMessageId: string;
    abortController: AbortController;
    projectRevision: string;
    executionMode: ExecuteInput['executionMode'];
    group: ReturnType<typeof generateGroupId>;
    commandBatch: CommandExecutionInput['commandBatch'];
    parsedCommandBatch: ParsedCommandBatch;
    onExecutionSettlementWarning: (warning: string | null) => void;
};

function tryRecordCommittedAgentRunWork(input: {
    runId: string;
    receipt: NonNullable<AgentApplyReceipt>;
    actions: Parameters<typeof recordAgentRunReceiptSaga>[0]['actions'];
    commandBatch?: Parameters<typeof recordAgentRunReceiptSaga>[0]['commandBatch'];
    revertGroupId?: string;
    committedRevision?: string;
    completesRun?: boolean;
}): string | null {
    try {
        recordAgentRunReceiptSaga({
            runId: input.runId,
            receipt: input.receipt,
            actions: input.actions,
            ...(input.commandBatch ? { commandBatch: input.commandBatch } : {}),
            ...(input.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            ...(input.committedRevision ? { committedRevision: input.committedRevision } : {}),
            ...(input.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
        });
        return null;
    } catch {
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function tryRecordTerminalFailure(input: Parameters<typeof agentRunLifecycle.recordError>[0]): void {
    try {
        agentRunLifecycle.recordError(input);
    } catch {
        // The user-visible failure remains authoritative when its recovery record cannot persist.
    }
}

function appendSettlementWarningToError(reason: string, warning: string | null): string {
    return warning ? `${reason}\n\n${warning}` : reason;
}

function appendSettlementWarning(content: string, warning: string | null): string {
    return warning ? `${content}\n\n_${warning}_` : content;
}

export async function executeImmediatePromptCommand(
    input: ExecuteImmediatePromptCommandInput
): Promise<AgentApplyReceipt | undefined> {
    const {
        runId,
        prompt,
        actions,
        assistantMessageId,
        abortController,
        projectRevision,
        executionMode,
        group,
        commandBatch,
        parsedCommandBatch,
        onExecutionSettlementWarning,
    } = input;
    agentRunLifecycle.transitionPhase({ runId, phase: 'executing', revision: projectRevision });
    const commandReceiptIdentity = `command:${runId}:${parsedCommandBatch.envelope.batchId}`;
    const commandLeaseResult = agentRunWorkLease.claim({
        runId,
        workId: parsedCommandBatch.envelope.batchId,
        ownerKind: 'command',
        cleanupOwner: 'command-executor',
        idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
        receiptIdentity: commandReceiptIdentity,
        idempotent: true,
        retriable: false,
    });
    if (commandLeaseResult.status !== 'claimed') {
        throw new Error(`Agent command work could not be claimed: ${commandLeaseResult.status}`);
    }
    const releaseCommandCancellation = agentRunCancellation.bindAbortController({
        runId,
        lease: commandLeaseResult.lease,
        controller: abortController,
        reason: 'User cancelled the run while command execution was active.',
    });
    let execution: Awaited<ReturnType<typeof executePlannedActions>>;
    try {
        execution = await executePlannedActions({
            prompt,
            actions,
            group,
            projectRevision,
            executionMode,
            signal: abortController.signal,
            commandBatch,
        });
        if (execution.status === 'invalidated' || execution.status === 'cancelled') {
            await agentRunCancellation.cancel({
                runId,
                reason:
                    execution.status === 'invalidated'
                        ? execution.reason
                        : 'User cancelled before the command committed.',
            });
        }
    } catch (error) {
        const commandExecutionSettlement = settleAgentRunWorkLeaseSafely({
            lease: commandLeaseResult.lease,
            terminalState: 'failed',
            evidence: 'none',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(
                    new Error('Failed command work lease settlement failed', {
                        cause: settlementError,
                    })
                ),
        });
        onExecutionSettlementWarning(commandExecutionSettlement.warning);
        throw error;
    } finally {
        releaseCommandCancellation();
    }
    let commandLeaseTerminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
    if (execution.status === 'committed' || execution.status === 'executed' || execution.status === 'no-op') {
        commandLeaseTerminalState = 'completed';
    } else if (execution.status === 'cancelled') {
        commandLeaseTerminalState = 'cancelled';
    }
    const commandLeaseSettlement = settleAgentRunWorkLeaseSafely({
        lease: commandLeaseResult.lease,
        terminalState: commandLeaseTerminalState,
        evidence:
            (execution.status === 'committed' || execution.status === 'executed') && execution.receipt
                ? 'verified-command-receipt'
                : 'none',
        settle: agentRunWorkLease.settle,
    });
    const commandLeasePersistenceWarning = commandLeaseSettlement.warning;

    if (execution.status === 'committed') {
        if (!execution.receipt) {
            throw new Error('Applied command did not return a verified receipt');
        }
        const receiptWarnings: string[] = [];
        if (execution.commitWarning) {
            receiptWarnings.push(`Post-commit project follow-up warning: ${execution.commitWarning}`);
        }
        if (execution.reportingWarning) {
            receiptWarnings.push(`AI history or notification reporting warning: ${execution.reportingWarning}`);
        }
        if (execution.finalizationEvidenceFailure) {
            receiptWarnings.push(getProjectCommitFinalizationWarning(execution.finalizationEvidenceFailure));
        }
        const runPersistenceWarning = tryRecordCommittedAgentRunWork({
            runId,
            receipt: execution.receipt,
            actions,
            commandBatch,
            revertGroupId: group.groupId,
            ...(execution.committedRevision ? { committedRevision: execution.committedRevision } : {}),
            completesRun: commandLeaseSettlement.accepted && execution.finalizationEvidenceFailure === undefined,
        });
        if (runPersistenceWarning) {
            receiptWarnings.push(runPersistenceWarning);
        }
        if (commandLeasePersistenceWarning && !runPersistenceWarning) {
            receiptWarnings.push(commandLeasePersistenceWarning);
        }
        if (execution.finalizationEvidenceFailure && commandLeaseSettlement.accepted) {
            tryRecordTerminalFailure({
                runId,
                error: normalizeAgentFailure({
                    category: 'internal',
                    source: 'command-execution',
                    related: {
                        targetIds: [...parsedCommandBatch.envelope.scope.targetIds],
                        commandIds: parsedCommandBatch.envelope.commands.map((command) => command.commandId),
                        workIds: [parsedCommandBatch.envelope.batchId],
                        receiptIdentities: [
                            `${execution.receipt.schemaVersion}:${execution.receipt.runId}:${execution.receipt.batchId}:${execution.receipt.outcome}`,
                        ],
                    },
                    knownDomain: true,
                }),
                terminal: true,
            });
        }
        const actionSummary = execution.actions
            .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
            .join('\n');
        const warningSummary = receiptWarnings.join(' ');
        const content = warningSummary
            ? `Applied:\n\n${actionSummary}\n\n${warningSummary} The project change committed. Do not retry automatically; inspect the current project state.`
            : `Executed:\n\n${actionSummary}`;
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: warningSummary || undefined,
            content,
        });
        return execution.receipt;
    }

    if (execution.status === 'executed') {
        if (!execution.receipt) {
            throw new Error('Executed command did not return a verified receipt');
        }
        const receiptWarnings: string[] = [];
        if (execution.executionWarning) {
            receiptWarnings.push(`Runtime follow-up warning: ${execution.executionWarning}`);
        }
        if (execution.reportingWarning) {
            receiptWarnings.push(`AI history or notification reporting warning: ${execution.reportingWarning}`);
        }
        const runPersistenceWarning = tryRecordCommittedAgentRunWork({
            runId,
            receipt: execution.receipt,
            actions,
            commandBatch,
            completesRun: commandLeaseSettlement.accepted,
        });
        if (runPersistenceWarning) {
            receiptWarnings.push(runPersistenceWarning);
        }
        if (commandLeasePersistenceWarning && !runPersistenceWarning) {
            receiptWarnings.push(commandLeasePersistenceWarning);
        }
        const actionSummary = execution.actions
            .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
            .join('\n');
        const warningSummary = receiptWarnings.join(' ');
        let content = `Executed:\n\n${actionSummary}`;
        if (warningSummary) {
            content = `${content}\n\n${warningSummary} The runtime command executed. Do not retry automatically; inspect the current runtime state.`;
        }
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: warningSummary || undefined,
            content,
        });
        return execution.receipt;
    }

    if (execution.status === 'invalidated') {
        if (commandLeaseSettlement.accepted) {
            await agentRunCancellation.cancel({ runId, reason: execution.reason });
        }
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: appendSettlementWarningToError(execution.reason, commandLeasePersistenceWarning),
            content: appendSettlementWarning(
                'The project changed before this command could commit. Review it and submit the command again.',
                commandLeasePersistenceWarning
            ),
        });
        return undefined;
    }

    if (execution.status === 'cancelled') {
        if (commandLeaseSettlement.accepted) {
            await agentRunCancellation.cancel({
                runId,
                reason: 'User cancelled before the command committed.',
            });
        }
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: commandLeasePersistenceWarning ?? undefined,
            content: appendSettlementWarning(
                'Command cancelled before it committed. No project changes were applied.',
                commandLeasePersistenceWarning
            ),
        });
        return undefined;
    }

    if (execution.status === 'no-op') {
        if (commandLeaseSettlement.accepted) {
            agentRunLifecycle.updateBatchStatus({
                runId,
                batchId: parsedCommandBatch.envelope.batchId,
                status: 'no-op',
            });
            agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
        }
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: commandLeasePersistenceWarning ?? undefined,
            content: appendSettlementWarning('No project changes were needed.', commandLeasePersistenceWarning),
        });
        return undefined;
    }

    if (execution.status === 'ambiguous') {
        if (commandLeaseSettlement.accepted) {
            tryRecordTerminalFailure({
                runId,
                error: normalizeAgentFailure({
                    category: 'conflict',
                    source: 'command-execution',
                    related: {
                        targetIds: [...parsedCommandBatch.envelope.scope.targetIds],
                        commandIds: parsedCommandBatch.envelope.commands.map((command) => command.commandId),
                        workIds: [parsedCommandBatch.envelope.batchId],
                    },
                    compensation: 'manual-repair',
                    knownDomain: true,
                }),
                terminal: true,
            });
        }
        updateChatMessage(assistantMessageId, {
            isStreaming: false,
            error: appendSettlementWarningToError(execution.reason, commandLeasePersistenceWarning),
            content: appendSettlementWarning(
                `The command stopped after an uncertain partial commit: ${execution.reason}. Do not retry it; inspect the project first.`,
                commandLeasePersistenceWarning
            ),
        });
        return undefined;
    }

    updateChatMessage(assistantMessageId, {
        isStreaming: false,
        error: appendSettlementWarningToError(execution.reason, commandLeasePersistenceWarning),
        content: appendSettlementWarning(
            `Failed to execute prompt command atomically: ${execution.reason}`,
            commandLeasePersistenceWarning
        ),
    });
    if (commandLeaseSettlement.accepted) {
        tryRecordTerminalFailure({
            runId,
            error: normalizeAgentFailure({
                category: 'project',
                source: 'command-execution',
                related: {
                    targetIds: [...parsedCommandBatch.envelope.scope.targetIds],
                    commandIds: parsedCommandBatch.envelope.commands.map((command) => command.commandId),
                    workIds: [parsedCommandBatch.envelope.batchId],
                },
                knownDomain: true,
            }),
            terminal: true,
        });
    }
    return undefined;
}
