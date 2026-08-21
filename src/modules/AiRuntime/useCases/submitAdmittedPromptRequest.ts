import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentExecutionMode } from '../models/AgentExecutionMode';
import { type ModelProviderResult } from '../models/ModelProviderProtocol';

import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentActionExecution } from './compileAgentActionExecution';
import { describePlannedAction } from './describePlannedAction';
import { executePromptActionGroup } from './executePromptActionGroup';
import { getProjectContext } from './getProjectContext';
import { notifyAiChange } from './notifyAiChange';
import { planPromptActions } from './planPromptActions';
import { recordAgentProviderUsage } from './recordAgentProviderUsage';

export type PromptRequestSource = 'prompt-bar' | 'preset';

type SubmitAdmittedPromptRequestInput = {
    prompt: string;
    source: PromptRequestSource;
    actions?: readonly AppAction[];
    requiresConfirmation?: boolean;
    signal?: AbortSignal;
};

type AdmittedPromptPreview = {
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    projectRevision: string;
    confirm: (signal?: AbortSignal) => ReturnType<typeof executePromptActionGroup>;
    cancel: () => Promise<void>;
};

export type SubmitAdmittedPromptRequestResult =
    | {
          status: Awaited<ReturnType<typeof executePromptActionGroup>>['status'] | 'rejected';
          runId: string;
      }
    | { status: 'awaiting-approval'; runId: string; preview: AdmittedPromptPreview };

function getPromptRunMode(_source: PromptRequestSource): AgentExecutionMode {
    return 'apply';
}

function transitionTerminalRun(runId: string, phase: 'completed' | 'failed' | 'cancelled'): void {
    const run = agentRunLifecycle.get(runId);
    if (run && !['completed', 'failed', 'cancelled', 'partially-completed'].includes(run.phase)) {
        agentRunLifecycle.transitionPhase({ runId, phase });
    }
}

/**
 * Admits submitting prompt surfaces into one persistent run before either local
 * planning or provider work starts. Presentation receives only run-safe preview
 * controls; command approval and execution remain application-owned.
 */
export async function submitAdmittedPromptRequest(
    input: SubmitAdmittedPromptRequestInput
): Promise<SubmitAdmittedPromptRequestResult> {
    const prompt = input.prompt.trim();
    const runId = `agent-run-${crypto.randomUUID()}`;
    const createdRevision = captureProjectRevision();
    agentRunLifecycle.create({
        runId,
        request: prompt,
        mode: getPromptRunMode(input.source),
        createdRevision,
    });
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning', revision: createdRevision });

    const cancel = async (): Promise<void> => {
        await agentRunCancellation.cancel({ runId, reason: 'Prompt request cancelled by the user.' });
    };
    const onAbort = () => void cancel();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    let providerLease: Extract<ReturnType<typeof agentRunWorkLease.claim>, { status: 'claimed' }>['lease'] | null =
        null;
    let providerSettled = false;
    let pendingProviderResult: ModelProviderResult | null = null;
    const recordPendingProviderResult = (terminal: boolean): void => {
        if (!pendingProviderResult) {
            return;
        }
        recordAgentProviderUsage(runId, pendingProviderResult, pendingProviderResult.correlationId, { terminal });
        pendingProviderResult = null;
    };
    const settleProvider = (
        terminalState: 'completed' | 'failed' | 'cancelled'
    ): ReturnType<typeof agentRunWorkLease.settle> | null => {
        if (!providerLease || providerSettled) {
            return null;
        }
        const settlement = agentRunWorkLease.settle({
            runId,
            workId: providerLease.workId,
            leaseId: providerLease.leaseId,
            cancellationGeneration: providerLease.cancellationGeneration,
            idempotencyKey: providerLease.idempotencyKey,
            receiptIdentity: providerLease.receiptIdentity,
            terminalState,
        });
        providerSettled = true;
        return settlement;
    };

    try {
        if (input.actions === undefined) {
            const claim = agentRunWorkLease.claim({
                runId,
                workId: 'provider-planning',
                ownerKind: 'provider',
                cleanupOwner: 'provider-adapter',
                idempotencyKey: `provider:prompt:${runId}`,
                receiptIdentity: `provider:prompt:${runId}`,
                idempotent: false,
                retriable: true,
                operation: 'read',
            });
            if (claim.status !== 'claimed') {
                transitionTerminalRun(runId, 'failed');
                notifyAiChange(
                    `Command not executed: prompt provider work could not be claimed (${claim.status}).`,
                    []
                );
                return { status: 'rejected', runId };
            }
            providerLease = claim.lease;
        }

        if (input.signal?.aborted) {
            await cancel();
            settleProvider('cancelled');
            return { status: 'rejected', runId };
        }

        const planned =
            input.actions === undefined
                ? await planPromptActions({
                      prompt,
                      signal: input.signal,
                      streamIdentity: { runId, requestId: `prompt-planning:${runId}`, cancellationGeneration: 0 },
                      onProviderAttempt: ({ backend, correlationId, estimatedTotalTokens, estimate }) => {
                          const category = backend === 'cloud' ? 'remoteTokens' : 'localAnalysis';
                          const reservation = agentRunLifecycle.reserveBudget({
                              runId,
                              attemptId: correlationId,
                              category,
                              estimate: estimatedTotalTokens,
                              provenance: 'versioned-estimate',
                              estimateMethod: estimate.method,
                          });
                          return reservation.status === 'reserved'
                              ? { status: 'admitted' as const }
                              : {
                                    status: 'rejected' as const,
                                    reason: reservation.reason ?? 'agent budget limit',
                                };
                      },
                      onProviderResult: (result) => {
                          recordPendingProviderResult(false);
                          pendingProviderResult = result;
                      },
                  })
                : {
                      context: getProjectContext(),
                      result: {
                          actions: [...input.actions],
                          rawText: prompt,
                          requiresConfirmation: false,
                      },
                      projectRevision: createdRevision,
                  };

        recordPendingProviderResult(true);
        const providerSettlement = settleProvider('completed');
        const currentRun = agentRunLifecycle.get(runId);
        if (
            input.signal?.aborted ||
            currentRun?.phase === 'cancelled' ||
            currentRun?.phase === 'partially-completed' ||
            (providerSettlement !== null && providerSettlement.status !== 'settled')
        ) {
            if (input.signal?.aborted && currentRun && currentRun.phase !== 'cancelled') {
                await cancel();
            }
            return { status: 'rejected', runId };
        }

        if (planned.result.rejectionReason) {
            transitionTerminalRun(runId, 'failed');
            notifyAiChange(`Command not executed: ${planned.result.rejectionReason}`, []);
            return { status: 'rejected', runId };
        }
        if (planned.result.actions.length === 0) {
            transitionTerminalRun(runId, 'completed');
            notifyAiChange('No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.', []);
            return { status: 'no-op', runId };
        }

        const actionLabels = planned.result.actions.map((action) =>
            describePlannedAction({ action, context: planned.context })
        );
        const compiled = compileAgentActionExecution({
            actions: planned.result.actions,
            actionLabels,
            context: planned.context,
            group: { groupId: `prompt-${runId}`, groupLabel: 'Prompt action' },
            intent: prompt,
            projectRevision: planned.projectRevision,
            runId,
            mode: 'apply',
            requiresConfirmation: planned.result.requiresConfirmation || input.requiresConfirmation === true,
        });
        const parsed = parseVersionedCommandBatchEnvelope(
            compiled.commandBatch.serialized,
            compiled.commandBatch.authority
        );
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const authority = compiled.commandBatch.authority;
        const run = agentRunLifecycle.get(runId);
        if (!run) {
            throw new Error('Admitted prompt run disappeared before command planning.');
        }
        agentRunLifecycle.recordPlan({
            runId,
            summary: actionLabels.join('\n'),
            commandIds: parsed.envelope.commands.map((command) => command.commandId),
            serializedBatchIdentity: parsed.envelope.idempotencyKey,
            revision: planned.projectRevision,
            scope: {
                targetIds: [...authority.scope.targetIds],
                targetRanges: authority.scope.targetRanges.map((range) => ({ ...range })),
                protectedTargetIds: [...authority.scope.protectedTargetIds],
                protectedRanges: authority.scope.protectedRanges.map((range) => ({ ...range })),
            },
            grants: {
                ...authority.grants,
                allowedOperationPrefixes: [...authority.grants.allowedOperationPrefixes],
            },
            budgets: run.budgets,
        });
        agentRunLifecycle.recordBatch({
            runId,
            batch: {
                batchId: parsed.envelope.batchId,
                commandIds: parsed.envelope.commands.map((command) => command.commandId),
                status: compiled.requiresConfirmation ? 'waiting-for-approval' : 'planned',
                receiptIdentity: null,
            },
        });

        const execute = async (
            successVerb?: 'Confirmed',
            signal: AbortSignal | undefined = input.signal
        ): ReturnType<typeof executePromptActionGroup> =>
            executePromptActionGroup({
                actions: planned.result.actions,
                prompt,
                projectRevision: planned.projectRevision,
                executionMode: planned.result.executionMode,
                signal,
                runId,
                prepared: compiled,
                ...(successVerb ? { successVerb } : {}),
            });

        if (compiled.requiresConfirmation) {
            agentRunLifecycle.transitionPhase({
                runId,
                phase: 'waiting-for-approval',
                revision: planned.projectRevision,
            });
            return {
                status: 'awaiting-approval',
                runId,
                preview: {
                    actions: planned.result.actions,
                    actionLabels,
                    projectRevision: planned.projectRevision,
                    confirm: (signal) => execute('Confirmed', signal),
                    cancel,
                },
            };
        }

        const execution = await execute();
        return { status: execution.status, runId };
    } catch (error) {
        recordPendingProviderResult(true);
        if (input.signal?.aborted) {
            await cancel();
            settleProvider('cancelled');
            return { status: 'rejected', runId };
        }
        settleProvider('failed');
        transitionTerminalRun(runId, 'failed');
        throw error;
    } finally {
        input.signal?.removeEventListener('abort', onAbort);
    }
}
