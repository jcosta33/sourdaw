import { logger } from '#/infra/logger/appLogger';
import { captureProjectRevision, settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { isAiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../../models/AgentExecutionMode';
import { type AgentRunCreationRefusalReason, describeAgentRunCreationRefusal } from '../../models/AgentResourceLimits';
import { type AgentRunBudgets, type AgentRunDecisionResume, type AgentRunWorkLease } from '../../models/AgentRun';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type AiBackendPreference, type RunnableAiBackend } from '../../models/LlmOrchestrationTypes';
import { type ModelProviderName } from '../../models/ModelProviderProtocol';
import { getCloudProviderInfo } from '../../repositories/cloudLlm/getCloudProviderInfo';
import { getActiveModelId } from '../../repositories/webLlm/getActiveModelId';
import { appendChatMessage, setActiveAborter, setChatGenerating, updateChatMessage } from '../../stores/chatStore';
import { describePlanningOutcome } from '../../transformers/describePlanningOutcome';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { ApplicationOwnedToolLoopRequestError } from '../applicationOwnedToolLoop';
import { agentRunCancellation } from '../cancelAgentRun';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { planPromptActions } from '../planPromptActions';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

import { executeImmediatePromptCommand } from './executeImmediatePromptCommand';
import { executePromptCommandPreview } from './executePromptCommandPreview';
import { materializePromptCommandPlan } from './materializePromptCommandPlan';
import { persistPromptActionConfirmation } from './persistPromptActionConfirmation';
import { AGENT_RUN_STALE_COMPLETION_WARNING, settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';

type PromptChatRequestOptions = {
    mode?: AgentExecutionMode;
    trustCeiling?: AgentTrustCeiling;
    budgets?: AgentRunBudgets;
    scope?: AgentRunDecisionResume['scope'];
    grants?: AgentRunDecisionResume['grants'];
    resume?: AgentRunDecisionResume;
    onResumedRunAdmitted?: (runId: string) => void;
    onResumedPlanAccepted?: () => void;
};

type PromptChatRequestInput = {
    userText: string;
    requestedRoute: AiBackendPreference;
    backend: RunnableAiBackend | 'none';
    interactionMode: Exclude<AgentExecutionMode, 'explain'>;
    options: PromptChatRequestOptions | undefined;
};

type AgentApplyReceipt = NonNullable<Awaited<ReturnType<typeof executeImmediatePromptCommand>>>;

type PromptRequestAdmission = {
    runId: string;
    planningReceiptIdentity: string;
    planningLease: AgentRunWorkLease;
    providerPlanning: boolean;
};

type PromptRequestAdmissionResult =
    | { status: 'admitted'; admission: PromptRequestAdmission }
    | { status: 'hard-limit-reached'; reason: AgentRunCreationRefusalReason };

type PromptRequestState = {
    assistantMessageId: string | null;
    planningLeaseSettled: boolean;
    commandExecutionSettlementWarning: string | null;
};

function getBackendModelId(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? (getCloudProviderInfo()?.model ?? 'cloud') : getActiveModelId();
}

function getModelProviderName(backend: RunnableAiBackend): ModelProviderName {
    return backend === 'webllm' ? backend : (getCloudProviderInfo()?.provider ?? 'openai-compatible');
}

function getProviderBudgetCategory(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? 'remoteTokens' : 'localAnalysis';
}

function tryRecordTerminalFailure(input: Parameters<typeof agentRunLifecycle.recordError>[0]): void {
    try {
        agentRunLifecycle.recordError(input);
    } catch {
        // The user-visible failure remains authoritative when its recovery record cannot persist.
    }
}

function recordApplicationToolOnlyPlan(input: {
    runId: string;
    revision: string;
    receipts: readonly ApplicationToolReceipt[];
}): void {
    if (input.receipts.length === 0) {
        return;
    }
    agentRunLifecycle.recordApplicationToolEvidence({
        runId: input.runId,
        summary: input.receipts
            .map((receipt) => `${receipt.toolName} (${receipt.callId}) ${receipt.status}: ${receipt.summary}`)
            .join('\n'),
        applicationToolReceipts: [...input.receipts],
        revision: input.revision,
        scope: {
            targetIds: [],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: { limits: {}, consumed: {} },
    });
}

function admitPromptRequest(input: PromptChatRequestInput): PromptRequestAdmissionResult {
    const runId = `agent-run-${crypto.randomUUID()}`;
    const created = agentRunLifecycle.create({
        runId,
        request: input.userText,
        mode: input.interactionMode,
        createdRevision: settlePendingProjectWritesAndCaptureRevision(),
        requestedRoute: input.requestedRoute,
        selectedRouteId:
            input.backend === 'none'
                ? undefined
                : `${input.backend}:${getModelProviderName(input.backend)}:${getBackendModelId(input.backend)}`,
        scope: input.options?.scope,
        grants: input.options?.grants,
        budgets: input.options?.budgets,
        resume: input.options?.resume,
    });
    if (created.status === 'hard-limit-reached') {
        return { status: 'hard-limit-reached', reason: created.reason };
    }
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
    const providerPlanning = input.backend !== 'none';
    const planningReceiptIdentity = providerPlanning ? `provider:${input.backend}:${runId}` : `local-planning:${runId}`;
    const planningLeaseResult = agentRunWorkLease.claim({
        runId,
        workId: providerPlanning ? 'provider-planning' : 'local-planning',
        ownerKind: providerPlanning ? 'provider' : 'analysis',
        cleanupOwner: providerPlanning ? 'provider-adapter' : 'prompt-planner',
        idempotencyKey: planningReceiptIdentity,
        receiptIdentity: planningReceiptIdentity,
        idempotent: false,
        retriable: true,
    });
    if (planningLeaseResult.status !== 'claimed') {
        const workKind = providerPlanning ? 'provider' : 'local planning';
        throw new Error(`Agent ${workKind} work could not be claimed: ${planningLeaseResult.status}`);
    }
    try {
        input.options?.onResumedRunAdmitted?.(runId);
    } catch (error) {
        settleAgentRunWorkLeaseSafely({
            lease: planningLeaseResult.lease,
            terminalState: 'failed',
            evidence: 'none',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(
                    new Error(
                        providerPlanning
                            ? 'Resumed provider work lease settlement failed'
                            : 'Resumed local planning work lease settlement failed',
                        { cause: settlementError }
                    )
                ),
        });
        try {
            agentRunLifecycle.transitionPhase({ runId, phase: 'failed' });
        } catch (lifecycleError) {
            logger.error(new Error('Resumed agent run lifecycle persistence failed', { cause: lifecycleError }));
        }
        throw error;
    }
    return {
        status: 'admitted',
        admission: {
            runId,
            planningReceiptIdentity,
            planningLease: planningLeaseResult.lease,
            providerPlanning,
        },
    };
}

function appendPlanRetentionWarning(userText: string, warning: string): void {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
        isCommandAction: true,
    });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `Command plan was not retained. ${warning}`,
        timestamp: Date.now(),
        error: warning,
        isCommandAction: true,
    });
}

function settleCompletedPlanning(input: PromptRequestAdmission, userText: string): boolean {
    const settlement = settleAgentRunWorkLeaseSafely({
        lease: input.planningLease,
        terminalState: 'completed',
        evidence: 'none',
        settle: agentRunWorkLease.settle,
        reportFailure: (settlementError) =>
            logger.error(
                new Error(
                    input.providerPlanning
                        ? 'Completed provider planning work lease settlement failed'
                        : 'Completed local planning work lease settlement failed',
                    {
                        cause: settlementError,
                    }
                )
            ),
    });
    if (settlement.accepted && settlement.warning === null) {
        return true;
    }
    appendPlanRetentionWarning(userText, settlement.warning ?? AGENT_RUN_STALE_COMPLETION_WARNING);
    return false;
}

async function dispatchPromptPlan(input: {
    request: PromptChatRequestInput;
    admission: PromptRequestAdmission;
    aborter: AbortController;
    state: PromptRequestState;
    context: Awaited<ReturnType<typeof planPromptActions>>['context'];
    result: Awaited<ReturnType<typeof planPromptActions>>['result'];
    projectRevision: string;
}): Promise<AgentApplyReceipt | undefined> {
    const { request, admission, aborter, state, context, result, projectRevision } = input;
    if (request.options?.resume && result.actions.length === 0) {
        throw new Error('The replacement provider returned no plan for the selected decision interpretation.');
    }
    if (result.actions.length === 0) {
        recordApplicationToolOnlyPlan({
            runId: admission.runId,
            revision: projectRevision,
            receipts: result.applicationToolReceipts ?? [],
        });
    }
    if (aborter.signal.aborted) {
        await agentRunCancellation.cancel({
            runId: admission.runId,
            reason: 'User cancelled the run before planning completed.',
        });
        return undefined;
    }
    if (result.actions.length > 0) {
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'user',
            content: request.userText,
            timestamp: Date.now(),
            isCommandAction: true,
        });
        const assistantMessageId = `msg-${crypto.randomUUID()}`;
        state.assistantMessageId = assistantMessageId;
        appendChatMessage({
            id: assistantMessageId,
            role: 'assistant',
            content: 'Executing...',
            timestamp: Date.now(),
            isCommandAction: true,
        });
        const confirmationDescription = describePendingActionConfirmation({
            actions: result.actions,
            context,
            prompt: request.userText,
            wholeProjectVibeMixPlan: result.wholeProjectVibeMixPlan,
            workflowCapabilityId: result.workflowCapabilityId,
        });
        const materializedPlan = materializePromptCommandPlan({
            userText: request.userText,
            runId: admission.runId,
            assistantMessageId,
            interactionMode: request.interactionMode,
            trustCeiling: request.options?.trustCeiling,
            resume: request.options?.resume,
            onResumedPlanAccepted: request.options?.onResumedPlanAccepted,
            projectRevision,
            context,
            result,
            actionLabels: confirmationDescription.actionLabels,
            protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
        });
        if (materializedPlan.status === 'terminal') {
            await materializedPlan.completion;
            return undefined;
        }
        const { commandGroup, compiledActionExecution, parsedCommandBatch } = materializedPlan;
        const { commandEnvelopes, commandBatch } = compiledActionExecution;
        if (request.interactionMode === 'preview') {
            await executePromptCommandPreview({
                runId: admission.runId,
                assistantMessageId,
                actions: result.actions,
                actionLabels: confirmationDescription.actionLabels,
                abortController: aborter,
                projectRevision,
                commandBatch,
                parsedCommandBatch,
                onExecutionSettlementWarning: (warning) => {
                    state.commandExecutionSettlementWarning = warning;
                },
            });
            return undefined;
        }
        if (compiledActionExecution.requiresConfirmation) {
            persistPromptActionConfirmation({
                runId: admission.runId,
                prompt: request.userText,
                assistantMessageId,
                actions: result.actions,
                actionLabels: confirmationDescription.actionLabels,
                commandEnvelopes,
                commandBatch,
                agentApproval: compiledActionExecution.agentApproval,
                affectedIds: confirmationDescription.affectedIds,
                protectedUnchanged: confirmationDescription.protectedUnchanged,
                matchSelectorPredicates: result.matchSelectorPredicates,
                executionMode: result.executionMode,
                group: commandGroup,
                projectRevision,
                parsedCommandBatch,
                content: confirmationDescription.content,
            });
            return undefined;
        }
        return executeImmediatePromptCommand({
            runId: admission.runId,
            prompt: request.userText,
            actions: result.actions,
            assistantMessageId,
            abortController: aborter,
            projectRevision,
            executionMode: result.executionMode,
            group: commandGroup,
            agentApproval: compiledActionExecution.allowApproval,
            commandBatch,
            parsedCommandBatch,
            onExecutionSettlementWarning: (warning) => {
                state.commandExecutionSettlementWarning = warning;
            },
        });
    }
    if (result.rejectionReason) {
        tryRecordTerminalFailure({
            runId: admission.runId,
            error: normalizeAgentFailure({
                category: /schema/i.test(result.rejectionReason) ? 'schema' : 'resolution',
                source: 'provider-planning',
                knownDomain: true,
            }),
            terminal: true,
        });
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'user',
            content: request.userText,
            timestamp: Date.now(),
        });
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'assistant',
            content: `Command not executed: ${result.rejectionReason}`,
            timestamp: Date.now(),
            error: result.rejectionReason,
        });
        return undefined;
    }
    agentRunLifecycle.transitionPhase({ runId: admission.runId, phase: 'completed' });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: request.userText,
        timestamp: Date.now(),
        isCommandAction: true,
    });
    const declineText = describePlanningOutcome(result.planningOutcome);
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: declineText ?? 'No actions were matched or executed for your command.',
        timestamp: Date.now(),
        error: declineText ?? 'No actions matched',
    });
    return undefined;
}

async function mapPromptFailure(input: {
    request: PromptChatRequestInput;
    admission: PromptRequestAdmission;
    aborter: AbortController;
    state: PromptRequestState;
    error: unknown;
}): Promise<void> {
    const { request, admission, aborter, state, error } = input;
    if (error instanceof ApplicationOwnedToolLoopRequestError && error.receipts.length > 0) {
        recordApplicationToolOnlyPlan({
            runId: admission.runId,
            revision: error.receipts.find((receipt) => receipt.revision !== null)?.revision ?? captureProjectRevision(),
            receipts: error.receipts,
        });
    }
    const reason = error instanceof Error ? error.message : String(error);
    const configurationChanged = isAiRuntimeConfigurationChangedError(error);
    const proposalInvalidated = error instanceof AiProposalInvalidatedError;
    let settlementWarning: string | null = state.commandExecutionSettlementWarning;
    if (aborter.signal.aborted || configurationChanged || proposalInvalidated) {
        await agentRunCancellation.cancel({ runId: admission.runId, reason });
    } else if (state.planningLeaseSettled) {
        tryRecordTerminalFailure({
            runId: admission.runId,
            error: normalizeAgentFailure({
                category: 'internal',
                source: 'provider-planning',
                knownDomain: false,
            }),
            terminal: true,
        });
    } else {
        const settlement = settleAgentRunWorkLeaseSafely({
            lease: admission.planningLease,
            terminalState: 'failed',
            evidence: 'none',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(
                    new Error(
                        admission.providerPlanning
                            ? 'Failed provider planning work lease settlement failed'
                            : 'Failed local planning work lease settlement failed',
                        {
                            cause: settlementError,
                        }
                    )
                ),
        });
        settlementWarning = settlement.warning;
        if (settlement.accepted) {
            tryRecordTerminalFailure({
                runId: admission.runId,
                error: normalizeAgentFailure({
                    category: 'internal',
                    source: 'provider-planning',
                    knownDomain: false,
                }),
                terminal: true,
            });
        }
    }
    let failureContent = 'Failed to process prompt command.';
    if (configurationChanged) {
        failureContent = 'Prompt cancelled because the AI configuration changed.';
    } else if (proposalInvalidated) {
        failureContent =
            'The project changed while this command was being planned. Review the current project and submit it again.';
    }
    const failureError = settlementWarning ? `${reason}\n\n${settlementWarning}` : reason;
    const failureContentWithWarning = settlementWarning
        ? `${failureContent}\n\n_${settlementWarning}_`
        : failureContent;
    let promptAssistantFailureContent = 'Failed to execute prompt command.';
    if (configurationChanged) {
        promptAssistantFailureContent = 'Prompt cancelled because the AI configuration changed.';
    } else if (settlementWarning) {
        promptAssistantFailureContent = `Failed to execute prompt command.\n\n_${settlementWarning}_`;
    }
    if (state.assistantMessageId) {
        updateChatMessage(state.assistantMessageId, {
            isStreaming: false,
            content: promptAssistantFailureContent,
            error: failureError,
        });
        return;
    }
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: request.userText,
        timestamp: Date.now(),
    });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: failureContentWithWarning,
        error: failureError,
        timestamp: Date.now(),
    });
}

export async function orchestratePromptChatRequest(
    input: PromptChatRequestInput
): Promise<AgentApplyReceipt | undefined> {
    const admissionResult = admitPromptRequest(input);
    if (admissionResult.status === 'hard-limit-reached') {
        const refusal = describeAgentRunCreationRefusal(admissionResult.reason);
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'user',
            content: input.userText,
            timestamp: Date.now(),
        });
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'assistant',
            content: refusal,
            error: refusal,
            timestamp: Date.now(),
        });
        return undefined;
    }
    const admission = admissionResult.admission;
    const aborter = new AbortController();
    const state: PromptRequestState = {
        assistantMessageId: null,
        planningLeaseSettled: false,
        commandExecutionSettlementWarning: null,
    };
    setChatGenerating(true);
    setActiveAborter(aborter);
    const releasePlanningCancellation = agentRunCancellation.bindAbortController({
        runId: admission.runId,
        lease: admission.planningLease,
        controller: aborter,
        reason: admission.providerPlanning
            ? 'User cancelled the run while provider planning was active.'
            : 'User cancelled the run while local planning was active.',
    });
    try {
        const { context, result, projectRevision } = await planPromptActions({
            prompt: input.userText,
            signal: aborter.signal,
            onProviderResult: admission.providerPlanning
                ? (providerResult) => {
                      recordAgentProviderUsage(admission.runId, providerResult, providerResult.correlationId);
                  }
                : undefined,
            streamIdentity: {
                runId: admission.runId,
                requestId: admission.planningReceiptIdentity,
                cancellationGeneration: admission.planningLease.cancellationGeneration,
            },
            onProviderAttempt: admission.providerPlanning
                ? ({ backend, correlationId, estimatedTotalTokens, estimate }) => {
                      const budgetReservation = agentRunLifecycle.reserveBudget({
                          runId: admission.runId,
                          attemptId: correlationId,
                          category: getProviderBudgetCategory(backend),
                          estimate: estimatedTotalTokens,
                          provenance: 'versioned-estimate',
                          estimateMethod: estimate.method,
                      });
                      return budgetReservation.status === 'reserved'
                          ? { status: 'admitted' as const }
                          : { status: 'rejected' as const, reason: budgetReservation.reason ?? 'agent budget limit' };
                  }
                : undefined,
            onLocalWorkAttempt: ({ analysisCount, downloadBytes, storageBytes }) => {
                const estimates = [
                    ['localAnalysis', analysisCount],
                    ['downloadBytes', downloadBytes],
                    ['storageBytes', storageBytes],
                ] as const;
                return (
                    agentRunLifecycle.reserveBudgetBatch({
                        runId: admission.runId,
                        attempts: estimates.map(([category, estimate]) => ({
                            attemptId: `stem-preparation:${category}`,
                            category,
                            estimate,
                            provenance: 'versioned-estimate',
                        })),
                    }).status === 'reserved'
                );
            },
            providerPlanning: admission.providerPlanning ? 'enabled' : 'disabled',
        });
        if (!settleCompletedPlanning(admission, input.userText)) {
            return undefined;
        }
        state.planningLeaseSettled = true;
        return await dispatchPromptPlan({
            request: input,
            admission,
            aborter,
            state,
            context,
            result,
            projectRevision,
        });
    } catch (error) {
        await mapPromptFailure({ request: input, admission, aborter, state, error });
    } finally {
        releasePlanningCancellation();
        setActiveAborter(null);
        setChatGenerating(false);
    }
    return undefined;
}
