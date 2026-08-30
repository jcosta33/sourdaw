import { logger } from '#/infra/logger/appLogger';
import {
    generateGroupId,
    isExecutableAppActionType,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunPhase, type AgentRunWorkTerminalState } from '../models/AgentRun';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { createStemImportConfirmationResourceLease } from './agentReference/createStemImportConfirmationResourceLease';
import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';
import { settleAgentRunWorkLeaseSafely } from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentRunCancellation } from './cancelAgentRun';
import { executePlannedActions } from './executePlannedActions';
import { getProjectCommitFinalizationWarning } from './getProjectCommitFinalizationWarning';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { notifyAiChange } from './notifyAiChange';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';

type ExecutePromptActionGroupInput = {
    actions: readonly AppAction[];
    prompt: string;
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
    onResourceOwnershipAcquired?: () => void;
    runId: string;
    prepared: {
        commandBatch: Parameters<typeof issueAgentCommandApprovalBinding>[0]['commandBatch'];
        agentApproval: Parameters<typeof issueAgentCommandApprovalBinding>[0]['approval'] | null;
        requiresConfirmation: boolean;
    };
};

type ExecutePromptActionGroupResult = {
    status: 'committed' | 'executed' | 'failed' | 'cancelled' | 'ambiguous' | 'no-op';
};

const TERMINAL_RUN_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);
const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative.';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function appendSettlementWarning(message: string, warning: string | null): string {
    if (!warning) {
        return message;
    }
    return `${message}${message.endsWith('.') ? ' ' : '. '}${warning}`;
}

function transitionRunIfLive(
    runId: string,
    phase: Extract<AgentRunPhase, 'completed' | 'failed' | 'partially-completed'>
): void {
    const run = agentRunLifecycle.get(runId);
    if (run && !TERMINAL_RUN_PHASES.has(run.phase)) {
        agentRunLifecycle.transitionPhase({ runId, phase });
    }
}

function getReceiptIdentity(receipt: Parameters<typeof recordAgentRunReceiptSaga>[0]['receipt']): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function recordCommittedCommandWarningSafe(input: {
    runId: string;
    receipt: Parameters<typeof recordAgentRunReceiptSaga>[0]['receipt'];
    actions: readonly AppAction[];
    commandBatch: Parameters<typeof recordAgentRunReceiptSaga>[0]['commandBatch'];
    committedRevision?: string;
    completesRun: boolean;
}): string | null {
    try {
        recordAgentRunReceiptSaga(input);
        return null;
    } catch (error) {
        logger.error(new Error('Prompt command receipt persistence failed after verified execution', { cause: error }));
        const receiptIdentity = getReceiptIdentity(input.receipt);
        try {
            agentRunLifecycle.updateBatchStatus({
                runId: input.runId,
                batchId: input.receipt.batchId,
                status: 'committed',
                receiptIdentity,
            });
            transitionRunIfLive(input.runId, input.completesRun ? 'completed' : 'partially-completed');
        } catch (fallbackError) {
            logger.error(
                new Error('Prompt command receipt fallback evidence could not be persisted', { cause: fallbackError })
            );
        }
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function reportCommittedWarning(input: {
    executionKind: 'project' | 'runtime';
    receiptIdentity: string;
    warnings: readonly string[];
    actionTypes: string[];
}): void {
    if (input.warnings.length === 0) {
        return;
    }
    const outcome = input.executionKind === 'project' ? 'Project change committed' : 'Runtime command executed';
    try {
        notifyAiChange(
            `${outcome} with follow-up warning: ${input.warnings.join(' ')} Verified receipt ${input.receiptIdentity} is authoritative. Do not retry automatically; inspect the current ${input.executionKind === 'project' ? 'project' : 'runtime'} state.`,
            input.actionTypes
        );
    } catch (error) {
        logger.error(
            new Error('Prompt command warning notification failed after verified execution', { cause: error })
        );
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

export async function executePromptActionGroup(
    input: ExecutePromptActionGroupInput
): Promise<ExecutePromptActionGroupResult> {
    const importedStems = input.actions.flatMap((action) =>
        action.type === 'importStemSet' ? action.payload.stems : []
    );
    const discardImportedStems = (): Promise<void> =>
        preparedStemImportResources.discard({ runId: input.runId, stems: importedStems });
    const parsed = parseVersionedCommandBatchEnvelope(
        input.prepared.commandBatch.serialized,
        input.prepared.commandBatch.authority
    );
    if (parsed.status === 'invalid') {
        const trackedBatch = agentRunLifecycle.get(input.runId)?.batches.at(-1);
        await discardImportedStems();
        rejectPreparedBatch({
            runId: input.runId,
            batchId: trackedBatch?.batchId ?? 'unavailable-batch',
            reason: parsed.reason,
        });
    }

    const { envelope } = parsed;
    const run = agentRunLifecycle.get(input.runId);
    const trackedBatch = run?.batches.at(-1);
    const preparedCommandIds = envelope.commands.map((command) => command.commandId);
    const batchIdentityMatches =
        run !== null &&
        envelope.runId === input.runId &&
        run.plan?.serializedBatchIdentity === envelope.idempotencyKey &&
        trackedBatch !== undefined &&
        trackedBatch.batchId === envelope.batchId &&
        trackedBatch.commandIds.length === preparedCommandIds.length &&
        trackedBatch.commandIds.every((commandId, index) => commandId === preparedCommandIds[index]);
    if (!batchIdentityMatches) {
        await discardImportedStems();
        rejectPreparedBatch({
            runId: input.runId,
            batchId: trackedBatch?.batchId ?? 'unavailable-batch',
            reason: `Prepared command batch ${envelope.batchId} does not belong to admitted run ${input.runId}.`,
        });
    }

    if (!input.actions.every((action) => isExecutableAppActionType(action.type))) {
        const reason = 'one or more actions are not available through the approved command boundary.';
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'failed' });
        transitionRunIfLive(input.runId, 'failed');
        await discardImportedStems();
        notifyAiChange(`Command not executed: ${reason}`, []);
        return { status: 'failed' };
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
        await discardImportedStems();
        notifyAiChange(`Command not executed: ${reason}`, []);
        throw new Error(reason);
    }
    const commandLease = leaseClaim.lease;
    const settleCommand = (
        terminalState: AgentRunWorkTerminalState,
        evidence: Parameters<typeof settleAgentRunWorkLeaseSafely>[0]['evidence']
    ) =>
        settleAgentRunWorkLeaseSafely({
            lease: commandLease,
            terminalState,
            evidence,
            settle: agentRunWorkLease.settle,
            reportFailure: (error) => {
                logger.error(new Error('Prompt command lease settlement failed', { cause: error }));
            },
        });
    const settleTerminalCommand = (outcome: Parameters<typeof agentRunWorkLease.getCommandTerminalOutcome>[0]) => {
        const terminal = agentRunWorkLease.getCommandTerminalOutcome(outcome);
        return settleAgentRunWorkLeaseSafely({
            lease: commandLease,
            terminalState: terminal.terminalState,
            evidence: 'none',
            settle: (lease) =>
                agentRunWorkLease.settleAndTerminalize({
                    ...lease,
                    outcome,
                }),
            reportFailure: (error) => {
                logger.error(new Error('Prompt command terminal settlement failed', { cause: error }));
            },
        });
    };
    const cancelCommand = (): Promise<unknown> =>
        agentRunCancellation.cancel({
            runId: input.runId,
            reason: 'Prompt command execution was cancelled before it committed.',
        });
    const onAbort = () => void cancelCommand();
    input.signal?.addEventListener('abort', onAbort, { once: true });

    if (input.signal?.aborted) {
        await discardImportedStems();
        await cancelCommand();
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        input.signal.removeEventListener('abort', onAbort);
        return { status: 'cancelled' };
    }

    const group = generateGroupId(input.prompt);
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
    const importedStemsHavePartialDurableBindings = importedStems.some(
        (stem) => Boolean(stem.assetLeaseId) !== Boolean(stem.assetHash)
    );
    if (importedStemsHavePartialDurableBindings) {
        const reason = 'Prepared stem durable asset binding is incomplete.';
        const leaseSettlement = settleTerminalCommand('failed');
        await discardImportedStems();
        notifyAiChange(appendSettlementWarning(`Command not executed: ${reason}`, leaseSettlement.warning), []);
        return { status: 'failed' };
    }
    const importedStemsHaveDurableBindings =
        importedStems.length > 0 && importedStems.every((stem) => stem.assetLeaseId && stem.assetHash);
    let importedStemResourceLease: ReturnType<typeof createStemImportConfirmationResourceLease>;
    try {
        // The action group owns cleanup from this point, including a failed
        // durable confirmation-lease acquisition.
        input.onResourceOwnershipAcquired?.();
        importedStemResourceLease = importedStemsHaveDurableBindings
            ? createStemImportConfirmationResourceLease(
                  input.actions,
                  `stem-promotion:${input.runId}:${envelope.batchId}`,
                  input.runId
              )
            : undefined;
    } catch (error) {
        const reason = getErrorMessage(error);
        const leaseSettlement = settleTerminalCommand('failed');
        try {
            await preparedStemImportResources.discardAfterVerifiedNoncommit({
                runId: input.runId,
                stems: importedStems,
            });
        } catch (cleanupError) {
            notifyAiChange(appendSettlementWarning(`Command not executed: ${reason}`, leaseSettlement.warning), []);
            throw new AggregateError([error, cleanupError], reason, { cause: cleanupError });
        }
        notifyAiChange(appendSettlementWarning(`Command not executed: ${reason}`, leaseSettlement.warning), []);
        throw error;
    }
    const releaseImportedStems = async (): Promise<void> => {
        if (importedStemResourceLease) {
            await importedStemResourceLease.release();
            return;
        }
        await discardImportedStems();
    };
    const releaseImportedStemsAfterPrimaryFailure = async (primaryError: unknown): Promise<void> => {
        try {
            await releaseImportedStems();
        } catch (cleanupError) {
            throw new AggregateError([primaryError, cleanupError], getErrorMessage(primaryError), {
                cause: cleanupError,
            });
        }
    };
    const completeCommittedImportedStemPromotion = async (): Promise<string | null> => {
        if (!importedStemResourceLease) {
            preparedStemImportResources.release({ runId: input.runId, stems: importedStems });
            return null;
        }
        try {
            await importedStemResourceLease.commit?.();
            await importedStemResourceLease.retain?.();
            return null;
        } catch (error) {
            logger.error(new Error('Committed stem asset promotion recovery remains pending', { cause: error }));
            return 'Committed stem asset promotion remains pending and will be retried through durable recovery.';
        }
    };
    const retainImportedStemsForRecovery = async (): Promise<void> => {
        if (importedStemResourceLease) {
            return;
        }
        preparedStemImportResources.retainForRecovery({
            runId: input.runId,
            stems: importedStems,
            recovery: { batchId: envelope.batchId, commandBatch },
        });
        await recoverPreparedStemImportResources({ runId: input.runId });
    };
    let execution: Awaited<ReturnType<typeof executePlannedActions>>;
    try {
        await importedStemResourceLease?.prepareForCommit?.(commandBatch);
        agentRunLifecycle.updateBatchStatus({ runId: input.runId, batchId: envelope.batchId, status: 'executing' });
        agentRunLifecycle.transitionPhase({
            runId: input.runId,
            phase: 'executing',
            revision: input.projectRevision,
        });
        execution = await executePlannedActions({
            ...input,
            group,
            commandBatch,
        });
    } catch (error) {
        const reason = getErrorMessage(error);
        const leaseSettlement = settleTerminalCommand('failed');
        await releaseImportedStemsAfterPrimaryFailure(error);
        notifyAiChange(appendSettlementWarning(`Command not executed: ${reason}`, leaseSettlement.warning), []);
        throw error;
    } finally {
        input.signal?.removeEventListener('abort', onAbort);
    }

    if (execution.status === 'committed' || execution.status === 'executed') {
        if (!execution.receipt) {
            const reason = 'Command execution completed without an exact verified receipt.';
            const leaseSettlement = settleTerminalCommand('ambiguous');
            await retainImportedStemsForRecovery();
            notifyAiChange(
                appendSettlementWarning(
                    `Command outcome is uncertain: ${reason} Inspect the project before retrying.`,
                    leaseSettlement.warning
                ),
                []
            );
            return { status: 'ambiguous' };
        }
        if (execution.receipt.runId !== input.runId || execution.receipt.batchId !== envelope.batchId) {
            const reason = 'Command execution returned a receipt for a different admitted batch.';
            const leaseSettlement = settleTerminalCommand('ambiguous');
            await retainImportedStemsForRecovery();
            notifyAiChange(
                appendSettlementWarning(
                    `Command outcome is uncertain: ${reason} Inspect the project before retrying.`,
                    leaseSettlement.warning
                ),
                []
            );
            return { status: 'ambiguous' };
        }
        const leaseSettlement = settleCommand('completed', 'verified-command-receipt');
        const receiptIdentity = getReceiptIdentity(execution.receipt);
        const receiptPersistenceWarning = recordCommittedCommandWarningSafe({
            runId: input.runId,
            receipt: execution.receipt,
            actions: input.actions,
            commandBatch,
            ...(execution.status === 'committed' && execution.committedRevision
                ? { committedRevision: execution.committedRevision }
                : {}),
            completesRun:
                leaseSettlement.accepted &&
                leaseSettlement.warning === null &&
                execution.finalizationEvidenceFailure === undefined,
        });
        const resourcePromotionWarning = await completeCommittedImportedStemPromotion();
        if ((!leaseSettlement.accepted || leaseSettlement.warning !== null) && receiptPersistenceWarning === null) {
            try {
                transitionRunIfLive(input.runId, 'partially-completed');
            } catch (error) {
                logger.error(
                    new Error('Prompt command warning phase could not be persisted after verified execution', {
                        cause: error,
                    })
                );
            }
        }
        if (execution.status === 'committed' && execution.finalizationEvidenceFailure) {
            try {
                agentRunLifecycle.recordError({
                    runId: input.runId,
                    error: normalizeAgentFailure({
                        category: 'internal',
                        source: 'command-execution',
                        related: {
                            workIds: [execution.receipt.batchId],
                            receiptIdentities: [receiptIdentity],
                        },
                        knownDomain: true,
                    }),
                    terminal: true,
                });
            } catch (error) {
                logger.error(new Error('Prompt command finalization warning could not be persisted', { cause: error }));
            }
        }
        reportCommittedWarning({
            executionKind: execution.status === 'committed' ? 'project' : 'runtime',
            receiptIdentity,
            warnings: [
                execution.status === 'committed' && execution.finalizationEvidenceFailure
                    ? getProjectCommitFinalizationWarning(execution.finalizationEvidenceFailure)
                    : null,
                leaseSettlement.warning,
                receiptPersistenceWarning,
                resourcePromotionWarning,
            ].filter((warning): warning is string => warning !== null),
            actionTypes: execution.actions.map((entry) => entry.actionType),
        });
        return { status: execution.status };
    }

    if (execution.status === 'cancelled') {
        await releaseImportedStems();
        await cancelCommand();
        notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
        return { status: 'cancelled' };
    }

    if (execution.status === 'invalidated' || execution.status === 'failed') {
        const leaseSettlement = settleTerminalCommand('failed');
        await releaseImportedStems();
        notifyAiChange(
            appendSettlementWarning(`Command not executed: ${execution.reason}`, leaseSettlement.warning),
            []
        );
        return { status: 'failed' };
    }

    if (execution.status === 'ambiguous') {
        const leaseSettlement = settleTerminalCommand('ambiguous');
        await retainImportedStemsForRecovery();
        notifyAiChange(
            appendSettlementWarning(
                `Command outcome is uncertain: ${execution.reason}. Inspect the project before retrying.`,
                leaseSettlement.warning
            ),
            []
        );
        return { status: 'ambiguous' };
    }

    const leaseSettlement = settleTerminalCommand('no-op');
    await releaseImportedStems();
    notifyAiChange(appendSettlementWarning('No project changes were needed.', leaseSettlement.warning), []);
    return { status: 'no-op' };
}
