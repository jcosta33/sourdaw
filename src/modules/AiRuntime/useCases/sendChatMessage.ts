import { isAppError } from '#/infra/errors/isAppError';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../errors/AiRuntimeError';
import {
    assertRemoteAgentDataPolicy,
    formatRemoteTransmissionDisclosure,
    REMOTE_TEXT_AGENT_DATA_CATEGORIES,
} from '../models/AgentDataPolicy';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';
import {
    type AgentRunBudgets,
    type AgentRunDecisionResume,
    type AgentRunWorkLease,
    type AgentRunWorkTerminalState,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ChatMessage } from '../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../models/ChatSystemPrompt';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { estimateCompiledProviderRequestTokenCeiling } from '../models/ModelProviderBudgetEstimate';
import {
    type ModelProviderFinish,
    type ModelProviderName,
    type ModelProviderResult,
    type ModelProviderSession,
} from '../models/ModelProviderProtocol';
import {
    type CloudChatCompletionOutcome,
    streamCloudChatCompletion,
} from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { getCloudProviderInfo } from '../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../repositories/cloudLlm/isCloudAvailable';
import { getActiveModelId } from '../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    setActiveAborter,
} from '../stores/chatStore';
import { llmStatusStore } from '../stores/llmStatusStore';
import { proposePendingActionConfirmation } from '../stores/pendingActionConfirmationStore';
import { getAgentPlanProposalIdentity } from '../transformers/normalizeAgentPlanProposal';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { createStemImportConfirmationResourceLease } from './agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { ApplicationOwnedToolLoopRequestError } from './applicationOwnedToolLoop';
import { buildAgentContext } from './buildAgentContext';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentActionExecution } from './compileAgentActionExecution';
import { createModelProviderStreamWriter } from './createModelProviderStreamWriter';
import { createThinkBlockParser } from './createThinkBlockParser';
import { describeAgentRiskApproval } from './describeAgentRiskApproval';
import { describePendingActionConfirmation } from './describePendingActionConfirmation';
import { remoteTransmissionDisclosure } from './discloseRemoteTransmission';
import { executePlannedActions } from './executePlannedActions';
import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { createModelProviderProtocol } from './modelProviderProtocol';
import { planAgentRun } from './planAgentRun';
import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { planPromptActions } from './planPromptActions';
import { recordAgentRunReceiptSaga } from './recordAgentRunReceiptSaga';
import { resolveAgentExecutionMode } from './resolveAgentExecutionMode';

function getBackendModelId(backend: RunnableAiBackend): string {
    if (backend === 'cloud') {
        return getCloudProviderInfo()?.model ?? 'cloud';
    }
    return getActiveModelId();
}

function getModelProviderName(backend: RunnableAiBackend): ModelProviderName {
    if (backend === 'webllm') {
        return backend;
    }
    return getCloudProviderInfo()?.provider ?? 'openai-compatible';
}

function getProviderDisplayName(backend: RunnableAiBackend): string {
    if (backend === 'cloud') {
        return 'Hosted AI';
    }
    return 'WebLLM';
}

function readProviderTokenCount(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

type SendChatMessageOptions = {
    mode?: AgentExecutionMode;
    trustCeiling?: AgentTrustCeiling;
    budgets?: AgentRunBudgets;
    scope?: AgentRunDecisionResume['scope'];
    grants?: AgentRunDecisionResume['grants'];
    resume?: AgentRunDecisionResume;
    onResumedRunAdmitted?: (runId: string) => void;
    onResumedPlanAccepted?: () => void;
};

function assertResumedProposalIdentity(
    input: { proposalIdentity: string } | undefined,
    value: Parameters<typeof getAgentPlanProposalIdentity>[0]
): void {
    const proposalIdentity = getAgentPlanProposalIdentity(value);
    if (input && proposalIdentity !== input.proposalIdentity) {
        throw new Error('The replacement provider plan no longer matches the selected decision interpretation.');
    }
}

type AgentApplyReceipt = Extract<
    Awaited<ReturnType<typeof executePlannedActions>>,
    { status: 'committed' | 'executed' }
>['receipt'];

const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const AGENT_RUN_STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';

function tryRecordCommittedAgentRunWork(input: {
    runId: string;
    receipt: NonNullable<AgentApplyReceipt>;
    actions: Parameters<typeof recordAgentRunReceiptSaga>[0]['actions'];
    revertGroupId?: string;
    committedRevision?: string;
    completesRun?: boolean;
}): string | null {
    try {
        recordAgentRunReceiptSaga({
            runId: input.runId,
            receipt: input.receipt,
            actions: input.actions,
            ...(input.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            ...(input.committedRevision ? { committedRevision: input.committedRevision } : {}),
            ...(input.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
        });
        return null;
    } catch {
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

type AgentRunWorkLeaseSettlement = {
    accepted: boolean;
    warning: string | null;
};

function trySettleAgentRunWorkLease(
    lease: AgentRunWorkLease,
    terminalState: AgentRunWorkTerminalState
): AgentRunWorkLeaseSettlement {
    try {
        const settlement = agentRunWorkLease.settle({
            runId: lease.runId,
            workId: lease.workId,
            leaseId: lease.leaseId,
            cancellationGeneration: lease.cancellationGeneration,
            idempotencyKey: lease.idempotencyKey,
            receiptIdentity: lease.receiptIdentity,
            terminalState,
        });
        return {
            accepted: settlement.status === 'settled',
            warning: settlement.status === 'settled' ? null : AGENT_RUN_STALE_COMPLETION_WARNING,
        };
    } catch {
        return { accepted: true, warning: AGENT_RUN_PERSISTENCE_WARNING };
    }
}

function recordModelProviderUsage(
    runId: string,
    result: ModelProviderResult,
    budgetAttemptId: string,
    options: { terminal: boolean } = { terminal: false }
): void {
    const executor: RunnableAiBackend = result.provider === 'webllm' ? 'webllm' : 'cloud';
    const routeId = `${executor}:${result.provider}:${result.model ?? 'unknown'}`;
    const existingAttempt = agentRunLifecycle
        .get(runId)
        ?.budgetAttempts.some((attempt) => attempt.attemptId === budgetAttemptId);
    if (!existingAttempt) {
        agentRunLifecycle.reserveBudget({
            runId,
            attemptId: budgetAttemptId,
            category: getProviderBudgetCategory(executor),
            estimate: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
            provenance: result.usage.provenance,
        });
    }
    agentRunLifecycle.recordProviderUsage({
        runId,
        usage: {
            provider: result.provider,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            provenance: result.usage.provenance,
            correlationId: result.correlationId,
            status: result.status,
            retryable: result.failure?.retryable ?? null,
            partialOutputDisposition: result.partialOutputDisposition,
            routeId,
            executor,
            ...(result.remoteDisclosure ? { disclosure: result.remoteDisclosure } : {}),
            fallbackReason:
                options.terminal || result.status === 'complete' ? null : (result.failure?.code ?? result.status),
        },
    });
    const consumed = (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
    agentRunLifecycle.reconcileBudgetAttempt({
        runId,
        attemptId: budgetAttemptId,
        consumed,
        mode: 'final',
        provenance: result.usage.provenance,
    });
}

function getProviderBudgetCategory(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? 'remoteTokens' : 'localAnalysis';
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

export async function sendChatMessage(
    userText: string,
    options?: SendChatMessageOptions
): Promise<AgentApplyReceipt | undefined> {
    const requestedRoute = aiBackendPreferenceStore.value ?? 'auto';
    const state = chatStore.value;
    if (!state || state.isGenerating) {
        return undefined;
    }
    const interactionMode = resolveAgentExecutionMode({ chatMode: state.chatMode, requestedMode: options?.mode });
    const backend = resolveBackend({
        operation: interactionMode === 'explain' ? 'text' : 'tools',
        modality: 'text',
        streaming: interactionMode === 'explain',
    });

    // Regular chat streams from one selected backend. Prompt mode delegates
    // readiness and provider fallback to generateToolCalls.
    if (backend === 'none') {
        throw createAiRuntimeError(
            'No AI backend available. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
        );
    }
    if (interactionMode === 'explain' && backend === 'webllm' && !getLlmEngine()) {
        throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
    }
    if (interactionMode === 'explain' && backend === 'cloud' && !isCloudAvailable()) {
        throw createAiRuntimeError('Hosted AI is not configured.');
    }

    const runId = `agent-run-${crypto.randomUUID()}`;
    agentRunLifecycle.create({
        runId,
        request: userText,
        mode: interactionMode,
        createdRevision: captureProjectRevision(),
        requestedRoute,
        selectedRouteId: `${backend}:${getModelProviderName(backend)}:${getBackendModelId(backend)}`,
        scope: options?.scope,
        grants: options?.grants,
        budgets: options?.budgets,
        resume: options?.resume,
    });
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
    const providerWorkId = interactionMode === 'explain' ? 'provider-response' : 'provider-planning';
    const providerReceiptIdentity = `provider:${backend}:${runId}`;
    const providerLeaseResult = agentRunWorkLease.claim({
        runId,
        workId: providerWorkId,
        ownerKind: 'provider',
        cleanupOwner: 'provider-adapter',
        idempotencyKey: providerReceiptIdentity,
        receiptIdentity: providerReceiptIdentity,
        idempotent: false,
        retriable: true,
    });
    if (providerLeaseResult.status !== 'claimed') {
        throw new Error(`Agent provider work could not be claimed: ${providerLeaseResult.status}`);
    }
    const providerLease = providerLeaseResult.lease;
    try {
        options?.onResumedRunAdmitted?.(runId);
    } catch (error) {
        try {
            agentRunWorkLease.settle({
                runId,
                workId: providerWorkId,
                leaseId: providerLease.leaseId,
                cancellationGeneration: providerLease.cancellationGeneration,
                idempotencyKey: providerLease.idempotencyKey,
                receiptIdentity: providerLease.receiptIdentity,
                terminalState: 'failed',
            });
        } finally {
            agentRunLifecycle.transitionPhase({ runId, phase: 'failed' });
        }
        throw error;
    }

    setChatGenerating(true);

    // ── Prompt Command Mode ──────────────────────────────────────────────
    if (interactionMode !== 'explain') {
        const aborter = new AbortController();
        let prompt_assistant_message_id: string | null = null;
        setActiveAborter(aborter);
        const releaseProviderCancellation = agentRunCancellation.bindAbortController({
            runId,
            lease: providerLease,
            controller: aborter,
            reason: 'User cancelled the run while provider planning was active.',
        });

        try {
            const { context, result, projectRevision } = await planPromptActions({
                prompt: userText,
                signal: aborter.signal,
                onProviderResult: (providerResult) => {
                    recordModelProviderUsage(runId, providerResult, providerResult.correlationId);
                },
                streamIdentity: {
                    runId,
                    requestId: providerReceiptIdentity,
                    cancellationGeneration: providerLease.cancellationGeneration,
                },
                onProviderAttempt: ({ backend: attemptBackend, correlationId, estimatedTotalTokens, estimate }) => {
                    const budgetReservation = agentRunLifecycle.reserveBudget({
                        runId,
                        attemptId: correlationId,
                        category: getProviderBudgetCategory(attemptBackend),
                        estimate: estimatedTotalTokens,
                        provenance: 'versioned-estimate',
                        estimateMethod: estimate.method,
                    });
                    return budgetReservation.status === 'reserved'
                        ? { status: 'admitted' as const }
                        : { status: 'rejected' as const, reason: budgetReservation.reason ?? 'agent budget limit' };
                },
                onLocalWorkAttempt: ({ analysisCount, downloadBytes, storageBytes }) => {
                    const estimates = [
                        ['localAnalysis', analysisCount],
                        ['downloadBytes', downloadBytes],
                        ['storageBytes', storageBytes],
                    ] as const;
                    return (
                        agentRunLifecycle.reserveBudgetBatch({
                            runId,
                            attempts: estimates.map(([category, estimate]) => ({
                                attemptId: `stem-preparation:${category}`,
                                category,
                                estimate,
                                provenance: 'versioned-estimate',
                            })),
                        }).status === 'reserved'
                    );
                },
            });
            agentRunWorkLease.settle({
                runId,
                workId: providerWorkId,
                leaseId: providerLease.leaseId,
                cancellationGeneration: providerLease.cancellationGeneration,
                idempotencyKey: providerLease.idempotencyKey,
                receiptIdentity: providerLease.receiptIdentity,
                terminalState: 'completed',
            });

            if (options?.resume && result.actions.length === 0) {
                throw new Error('The replacement provider returned no plan for the selected decision interpretation.');
            }
            if (result.actions.length === 0) {
                recordApplicationToolOnlyPlan({
                    runId,
                    revision: projectRevision,
                    receipts: result.applicationToolReceipts ?? [],
                });
            }

            if (aborter.signal.aborted) {
                await agentRunCancellation.cancel({
                    runId,
                    reason: 'User cancelled the run before planning completed.',
                });
                return undefined;
            }

            if (result.actions.length > 0) {
                // Manually inject messages for Fast-Path execution
                const userMsgId = `msg-${crypto.randomUUID()}`;
                appendChatMessage({
                    id: userMsgId,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const assistantMsgId = `msg-${crypto.randomUUID()}`;
                prompt_assistant_message_id = assistantMsgId;
                appendChatMessage({
                    id: assistantMsgId,
                    role: 'assistant',
                    content: 'Executing...',
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const confirmationDescription = describePendingActionConfirmation({
                    actions: result.actions,
                    context,
                    prompt: userText,
                    wholeProjectVibeMixPlan: result.wholeProjectVibeMixPlan,
                    workflowCapabilityId: result.workflowCapabilityId,
                });
                if (interactionMode === 'plan') {
                    const admittedRun = agentRunLifecycle.get(runId);
                    if (!admittedRun) {
                        throw new Error('Agent run disappeared before plan materialization.');
                    }
                    const plannedAuthority = compileAgentActionExecution({
                        actions: result.actions,
                        actionLabels: confirmationDescription.actionLabels,
                        context,
                        group: generateGroupId(userText),
                        intent: userText,
                        projectRevision,
                        requiresConfirmation: result.requiresConfirmation,
                        runId,
                        mode: 'apply',
                        protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
                        trustCeiling: options?.trustCeiling,
                    }).commandBatch.authority;
                    const planScope = {
                        targetIds: [...plannedAuthority.scope.targetIds],
                        targetRanges: plannedAuthority.scope.targetRanges.map((range) => ({ ...range })),
                        protectedTargetIds: [...plannedAuthority.scope.protectedTargetIds],
                        protectedRanges: plannedAuthority.scope.protectedRanges.map((range) => ({ ...range })),
                    };
                    const planGrants = {
                        ...plannedAuthority.grants,
                        allowedOperationPrefixes: [...plannedAuthority.grants.allowedOperationPrefixes],
                    };
                    assertResumedProposalIdentity(options?.resume, {
                        actions: result.actions,
                        providerProposal: result.providerProposal ?? null,
                        scope: planScope,
                        grants: planGrants,
                    });
                    const plannedRun = planAgentRun({
                        request: userText,
                        revision: projectRevision,
                        actions: result.actions,
                        actionLabels: confirmationDescription.actionLabels,
                        scope: planScope,
                        grants: planGrants,
                        budgets: admittedRun.budgets,
                        requiresConfirmation: false,
                        applicationToolReceipts: result.applicationToolReceipts,
                        providerProposal: result.providerProposal,
                        requireProviderProposal: result.executionMode === 'atomic',
                    });
                    if (plannedRun.status === 'needs-user-decision') {
                        await createStemImportConfirmationResourceLease(result.actions)?.releaseBestEffort();
                        agentRunLifecycle.requireManualResume({
                            runId,
                            reason: plannedRun.decision.reason,
                            workIds: [],
                        });
                        agentRunLifecycle.recordDecision({
                            runId,
                            decision: {
                                decisionId: crypto.randomUUID(),
                                capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
                                proposalIdentity: getAgentPlanProposalIdentity({
                                    actions: result.actions,
                                    providerProposal: result.providerProposal ?? null,
                                    scope: planScope,
                                    grants: planGrants,
                                }),
                                budgets: admittedRun.budgets,
                                revision: projectRevision,
                                scope: planScope,
                                grants: planGrants,
                                alternatives: plannedRun.decision.alternatives,
                                reason: plannedRun.decision.reason,
                                selectedAlternativeId: null,
                                resumeAttemptId: null,
                            },
                        });
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            content: `Choose one before I continue:\n\n${plannedRun.decision.alternatives.map((alternative) => `- ${alternative.label}`).join('\n')}`,
                        });
                        return undefined;
                    }
                    if (plannedRun.status === 'rejected') {
                        throw new Error(plannedRun.reason);
                    }
                    options?.onResumedPlanAccepted?.();
                    agentRunLifecycle.recordPlan({
                        runId,
                        summary: confirmationDescription.actionLabels.join('\n'),
                        commandIds: [],
                        serializedBatchIdentity: null,
                        applicationToolReceipts: result.applicationToolReceipts ?? [],
                        revision: projectRevision,
                        scope: planScope,
                        grants: planGrants,
                        budgets: admittedRun.budgets,
                        plan: plannedRun.plan,
                    });
                    agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                    await createStemImportConfirmationResourceLease(result.actions)?.releaseBestEffort();
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: `Planned without changing the project:\n\n${confirmationDescription.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                    });
                    return undefined;
                }
                const commandGroup = generateGroupId(userText);
                const compiledActionExecution = compileAgentActionExecution({
                    actions: result.actions,
                    actionLabels: confirmationDescription.actionLabels,
                    context,
                    group: commandGroup,
                    intent: userText,
                    projectRevision,
                    requiresConfirmation: result.requiresConfirmation,
                    runId,
                    mode: interactionMode,
                    protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
                    trustCeiling: options?.trustCeiling,
                });
                const { commandEnvelopes, commandBatch } = compiledActionExecution;
                const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
                    commandBatch.serialized,
                    commandBatch.authority
                );
                if (parsedCommandBatch.status === 'invalid') {
                    throw new Error(parsedCommandBatch.reason);
                }
                const commandIds = parsedCommandBatch.envelope.commands.map((command) => command.commandId);
                assertResumedProposalIdentity(options?.resume, {
                    actions: result.actions,
                    providerProposal: result.providerProposal ?? null,
                    scope: commandBatch.authority.scope,
                    grants: commandBatch.authority.grants,
                });
                const plannedRun = planAgentRun({
                    request: userText,
                    revision: projectRevision,
                    actions: result.actions,
                    actionLabels: confirmationDescription.actionLabels,
                    scope: {
                        targetIds: [...commandBatch.authority.scope.targetIds],
                        targetRanges: commandBatch.authority.scope.targetRanges.map((range) => ({ ...range })),
                        protectedTargetIds: [...commandBatch.authority.scope.protectedTargetIds],
                        protectedRanges: commandBatch.authority.scope.protectedRanges.map((range) => ({ ...range })),
                    },
                    grants: {
                        allowedOperationPrefixes: [...commandBatch.authority.grants.allowedOperationPrefixes],
                        create: commandBatch.authority.grants.create,
                        delete: commandBatch.authority.grants.delete,
                        routing: commandBatch.authority.grants.routing,
                        tempo: commandBatch.authority.grants.tempo,
                        master: commandBatch.authority.grants.master,
                        file: commandBatch.authority.grants.file,
                        audioUpload: commandBatch.authority.grants.audioUpload,
                        remoteGeneration: commandBatch.authority.grants.remoteGeneration,
                        autoCommit: commandBatch.authority.grants.autoCommit,
                    },
                    budgets: { limits: { ...commandBatch.authority.budgets }, consumed: {} },
                    requiresConfirmation: compiledActionExecution.requiresConfirmation,
                    applicationToolReceipts: result.applicationToolReceipts,
                    providerProposal: result.providerProposal,
                    requireProviderProposal: result.executionMode === 'atomic',
                });
                if (plannedRun.status === 'needs-user-decision') {
                    options?.onResumedPlanAccepted?.();
                    await createStemImportConfirmationResourceLease(result.actions)?.releaseBestEffort();
                    agentRunLifecycle.requireManualResume({
                        runId,
                        reason: plannedRun.decision.reason,
                        workIds: [],
                    });
                    const admittedRun = agentRunLifecycle.get(runId);
                    if (!admittedRun) {
                        throw new Error('Agent run disappeared before decision persistence.');
                    }
                    agentRunLifecycle.recordDecision({
                        runId,
                        decision: {
                            decisionId: crypto.randomUUID(),
                            capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
                            proposalIdentity: getAgentPlanProposalIdentity({
                                actions: result.actions,
                                providerProposal: result.providerProposal ?? null,
                                scope: commandBatch.authority.scope,
                                grants: commandBatch.authority.grants,
                            }),
                            budgets: admittedRun.budgets,
                            revision: projectRevision,
                            scope: {
                                targetIds: [...commandBatch.authority.scope.targetIds],
                                targetRanges: commandBatch.authority.scope.targetRanges.map((range) => ({ ...range })),
                                protectedTargetIds: [...commandBatch.authority.scope.protectedTargetIds],
                                protectedRanges: commandBatch.authority.scope.protectedRanges.map((range) => ({
                                    ...range,
                                })),
                            },
                            grants: {
                                allowedOperationPrefixes: [...commandBatch.authority.grants.allowedOperationPrefixes],
                                create: commandBatch.authority.grants.create,
                                delete: commandBatch.authority.grants.delete,
                                routing: commandBatch.authority.grants.routing,
                                tempo: commandBatch.authority.grants.tempo,
                                master: commandBatch.authority.grants.master,
                                file: commandBatch.authority.grants.file,
                                audioUpload: commandBatch.authority.grants.audioUpload,
                                remoteGeneration: commandBatch.authority.grants.remoteGeneration,
                                autoCommit: commandBatch.authority.grants.autoCommit,
                            },
                            alternatives: plannedRun.decision.alternatives,
                            reason: plannedRun.decision.reason,
                            selectedAlternativeId: null,
                            resumeAttemptId: null,
                        },
                    });
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: `Choose one before I can prepare this run:\n\n${plannedRun.decision.alternatives.map((alternative) => `- ${alternative.label}`).join('\n')}`,
                    });
                    return undefined;
                }
                if (plannedRun.status === 'rejected') {
                    throw new Error(plannedRun.reason);
                }
                options?.onResumedPlanAccepted?.();
                agentRunLifecycle.recordPlan({
                    runId,
                    summary: confirmationDescription.actionLabels.join('\n'),
                    commandIds,
                    serializedBatchIdentity: parsedCommandBatch.envelope.idempotencyKey,
                    applicationToolReceipts: result.applicationToolReceipts ?? [],
                    revision: projectRevision,
                    scope: {
                        targetIds: [...commandBatch.authority.scope.targetIds],
                        targetRanges: commandBatch.authority.scope.targetRanges.map((range) => ({ ...range })),
                        protectedTargetIds: [...commandBatch.authority.scope.protectedTargetIds],
                        protectedRanges: commandBatch.authority.scope.protectedRanges.map((range) => ({ ...range })),
                    },
                    grants: {
                        allowedOperationPrefixes: [...commandBatch.authority.grants.allowedOperationPrefixes],
                        create: commandBatch.authority.grants.create,
                        delete: commandBatch.authority.grants.delete,
                        routing: commandBatch.authority.grants.routing,
                        tempo: commandBatch.authority.grants.tempo,
                        master: commandBatch.authority.grants.master,
                        file: commandBatch.authority.grants.file,
                        audioUpload: commandBatch.authority.grants.audioUpload,
                        remoteGeneration: commandBatch.authority.grants.remoteGeneration,
                        autoCommit: commandBatch.authority.grants.autoCommit,
                    },
                    budgets: {
                        limits: { ...commandBatch.authority.budgets },
                        consumed: {},
                    },
                    plan: {
                        ...plannedRun.plan,
                        commandIds,
                        serializedBatchIdentity: parsedCommandBatch.envelope.idempotencyKey,
                    },
                });
                agentRunLifecycle.recordBatch({
                    runId,
                    batch: {
                        batchId: parsedCommandBatch.envelope.batchId,
                        commandIds,
                        status: compiledActionExecution.requiresConfirmation ? 'waiting-for-approval' : 'planned',
                        receiptIdentity: null,
                    },
                });
                if (interactionMode === 'preview') {
                    const previewWorkId = `preview:${parsedCommandBatch.envelope.batchId}`;
                    const previewReceiptIdentity = `preview:${runId}:${parsedCommandBatch.envelope.batchId}`;
                    const previewLeaseResult = agentRunWorkLease.claim({
                        runId,
                        workId: previewWorkId,
                        ownerKind: 'command',
                        cleanupOwner: 'command-preview',
                        idempotencyKey: previewReceiptIdentity,
                        receiptIdentity: previewReceiptIdentity,
                        idempotent: true,
                        retriable: false,
                    });
                    if (previewLeaseResult.status !== 'claimed') {
                        throw new Error(`Agent preview work could not be claimed: ${previewLeaseResult.status}`);
                    }
                    agentRunLifecycle.transitionPhase({ runId, phase: 'previewing', revision: projectRevision });
                    const resourceLease = createStemImportConfirmationResourceLease(result.actions);
                    const releasePreviewCancellation = agentRunCancellation.bindAbortController({
                        runId,
                        lease: previewLeaseResult.lease,
                        controller: aborter,
                        reason: 'User cancelled the run while command preview was active.',
                    });
                    let preview: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
                    try {
                        preview = await executeVersionedCommandBatchEnvelope(commandBatch);
                        if (preview.status === 'cancelled') {
                            await agentRunCancellation.cancel({ runId, reason: preview.reason });
                        } else if (
                            (preview.status === 'rejected' ||
                                preview.status === 'conflicted' ||
                                preview.status === 'failed') &&
                            captureProjectRevision() !== projectRevision
                        ) {
                            await agentRunCancellation.cancel({ runId, reason: preview.reason });
                        }
                    } catch (error) {
                        trySettleAgentRunWorkLease(previewLeaseResult.lease, 'failed');
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'failed',
                        });
                        throw error;
                    } finally {
                        releasePreviewCancellation();
                        await resourceLease?.releaseBestEffort();
                    }
                    if (preview.status === 'previewed') {
                        preview.resource.release();
                        const settlement = agentRunWorkLease.settle({
                            runId,
                            workId: previewWorkId,
                            leaseId: previewLeaseResult.lease.leaseId,
                            cancellationGeneration: previewLeaseResult.lease.cancellationGeneration,
                            idempotencyKey: previewLeaseResult.lease.idempotencyKey,
                            receiptIdentity: previewLeaseResult.lease.receiptIdentity,
                            terminalState: 'completed',
                        });
                        if (settlement.status !== 'settled') {
                            const currentRun = agentRunLifecycle.get(runId);
                            if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                                return undefined;
                            }
                            throw new Error(`Agent preview work could not be settled: ${settlement.status}`);
                        }
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'previewed',
                        });
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            content: `Previewed without changing the project:\n\n${confirmationDescription.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                        });
                        agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                        return undefined;
                    }
                    const previewSettlement = trySettleAgentRunWorkLease(
                        previewLeaseResult.lease,
                        preview.status === 'cancelled' ? 'cancelled' : 'failed'
                    );
                    if (!previewSettlement.accepted) {
                        const currentRun = agentRunLifecycle.get(runId);
                        if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                            return undefined;
                        }
                        throw new Error('Agent preview work could not be settled after a non-preview outcome');
                    }
                    agentRunLifecycle.updateBatchStatus({
                        runId,
                        batchId: parsedCommandBatch.envelope.batchId,
                        status: 'failed',
                    });
                    throw new Error('reason' in preview ? preview.reason : 'Command preview did not produce a preview');
                }

                if (compiledActionExecution.requiresConfirmation) {
                    const { agentApproval } = compiledActionExecution;
                    const confirmationId = `prompt-confirmation-${crypto.randomUUID()}`;
                    const confirmation = proposePendingActionConfirmation({
                        id: confirmationId,
                        runId,
                        prompt: userText,
                        assistantMessageId: assistantMsgId,
                        actions: result.actions,
                        actionLabels: confirmationDescription.actionLabels,
                        commandEnvelopes,
                        commandBatch,
                        agentApproval,
                        affectedIds: confirmationDescription.affectedIds,
                        protectedUnchanged: confirmationDescription.protectedUnchanged,
                        risk: {
                            level: agentApproval.policy.risk,
                            reason: agentApproval.policy.reasons.join(' ') || null,
                        },
                        executionMode: result.executionMode,
                        groupId: commandGroup.groupId,
                        groupLabel: commandGroup.groupLabel,
                        projectRevision,
                        resourceLease: createStemImportConfirmationResourceLease(
                            result.actions,
                            `stem-promotion:${confirmationId}`
                        ),
                    });
                    if (!confirmation) {
                        const reason = 'Prepared action resources exceed the live confirmation limit.';
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'failed',
                        });
                        agentRunLifecycle.recordError({
                            runId,
                            error: normalizeAgentFailure({
                                category: 'budget',
                                source: 'command-execution',
                                related: {
                                    targetIds: [...parsedCommandBatch.envelope.scope.targetIds],
                                    commandIds: parsedCommandBatch.envelope.commands.map(
                                        (command) => command.commandId
                                    ),
                                    workIds: [parsedCommandBatch.envelope.batchId],
                                },
                                retry: 'never',
                                knownDomain: true,
                            }),
                            terminal: true,
                        });
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            pendingActionConfirmationStatus: 'failed',
                            error: reason,
                            content:
                                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
                        });
                        return undefined;
                    }

                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        pendingActionConfirmationId: confirmationId,
                        pendingActionConfirmationStatus: 'proposed',
                        content: `${confirmationDescription.content}\n\n${describeAgentRiskApproval(agentApproval)}`,
                    });
                    agentRunLifecycle.transitionPhase({
                        runId,
                        phase: 'waiting-for-approval',
                        revision: projectRevision,
                    });
                    return undefined;
                }

                const executionInput = {
                    prompt: userText,
                    actions: result.actions,
                    group: commandGroup,
                    projectRevision,
                    executionMode: result.executionMode,
                    signal: aborter.signal,
                };
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
                    controller: aborter,
                    reason: 'User cancelled the run while command execution was active.',
                });
                let execution: Awaited<ReturnType<typeof executePlannedActions>>;
                try {
                    execution = await executePlannedActions({ ...executionInput, commandBatch });
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
                    trySettleAgentRunWorkLease(commandLeaseResult.lease, 'failed');
                    throw error;
                } finally {
                    releaseCommandCancellation();
                }
                let commandLeaseTerminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
                if (
                    execution.status === 'committed' ||
                    execution.status === 'executed' ||
                    execution.status === 'no-op'
                ) {
                    commandLeaseTerminalState = 'completed';
                } else if (execution.status === 'cancelled') {
                    commandLeaseTerminalState = 'cancelled';
                }
                const commandLeaseSettlement = trySettleAgentRunWorkLease(
                    commandLeaseResult.lease,
                    commandLeaseTerminalState
                );
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
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const runPersistenceWarning = tryRecordCommittedAgentRunWork({
                        runId,
                        receipt: execution.receipt,
                        actions: result.actions,
                        revertGroupId: commandGroup.groupId,
                        committedRevision: captureProjectRevision(),
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
                    const content = warningSummary
                        ? `Applied:\n\n${actionSummary}\n\n${warningSummary} The project change committed. Do not retry automatically; inspect the current project state.`
                        : `Executed:\n\n${actionSummary}`;
                    updateChatMessage(assistantMsgId, {
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
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const runPersistenceWarning = tryRecordCommittedAgentRunWork({
                        runId,
                        receipt: execution.receipt,
                        actions: result.actions,
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
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: warningSummary || undefined,
                        content,
                    });
                    return execution.receipt;
                }

                if (execution.status === 'invalidated') {
                    if (commandLeaseSettlement.accepted) {
                        await agentRunCancellation.cancel({
                            runId,
                            reason: execution.reason,
                        });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content:
                            'The project changed before this command could commit. Review it and submit the command again.',
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
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'Command cancelled before it committed. No project changes were applied.',
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
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'No project changes were needed.',
                    });
                    return undefined;
                }

                if (execution.status === 'ambiguous') {
                    if (commandLeaseSettlement.accepted) {
                        agentRunLifecycle.recordError({
                            runId,
                            error: normalizeAgentFailure({
                                category: 'conflict',
                                source: 'command-execution',
                                related: {
                                    targetIds: [...parsedCommandBatch.envelope.scope.targetIds],
                                    commandIds: parsedCommandBatch.envelope.commands.map(
                                        (command) => command.commandId
                                    ),
                                    workIds: [parsedCommandBatch.envelope.batchId],
                                },
                                compensation: 'manual-repair',
                                knownDomain: true,
                            }),
                            terminal: true,
                        });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content: `The command stopped after an uncertain partial commit: ${execution.reason}. Do not retry it; inspect the project first.`,
                    });
                    return undefined;
                }

                updateChatMessage(assistantMsgId, {
                    isStreaming: false,
                    error: execution.reason,
                    content: `Failed to execute prompt command atomically: ${execution.reason}`,
                });
                if (commandLeaseSettlement.accepted) {
                    agentRunLifecycle.recordError({
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
            } else if (result.rejectionReason) {
                agentRunLifecycle.recordError({
                    runId,
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
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: `Command not executed: ${result.rejectionReason}`,
                    timestamp: Date.now(),
                    error: result.rejectionReason,
                });
            } else {
                agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
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
                    content: 'No actions were matched or executed for your command.',
                    timestamp: Date.now(),
                    error: 'No actions matched',
                });
            }
        } catch (error) {
            if (error instanceof ApplicationOwnedToolLoopRequestError && error.receipts.length > 0) {
                recordApplicationToolOnlyPlan({
                    runId,
                    revision:
                        error.receipts.find((receipt) => receipt.revision !== null)?.revision ??
                        captureProjectRevision(),
                    receipts: error.receipts,
                });
            }
            const reason = error instanceof Error ? error.message : String(error);
            const configurationChanged = isAiRuntimeConfigurationChangedError(error);
            const proposalInvalidated = error instanceof AiProposalInvalidatedError;
            if (aborter.signal.aborted || configurationChanged || proposalInvalidated) {
                await agentRunCancellation.cancel({ runId, reason });
            } else {
                trySettleAgentRunWorkLease(providerLease, 'failed');
                agentRunLifecycle.recordError({
                    runId,
                    error: normalizeAgentFailure({
                        category: 'internal',
                        source: 'provider-planning',
                        knownDomain: false,
                    }),
                    terminal: true,
                });
            }
            let failureContent = 'Failed to process prompt command.';
            if (configurationChanged) {
                failureContent = 'Prompt cancelled because the AI configuration changed.';
            } else if (proposalInvalidated) {
                failureContent =
                    'The project changed while this command was being planned. Review the current project and submit it again.';
            }
            if (prompt_assistant_message_id) {
                updateChatMessage(prompt_assistant_message_id, {
                    isStreaming: false,
                    content: configurationChanged
                        ? 'Prompt cancelled because the AI configuration changed.'
                        : 'Failed to execute prompt command.',
                    error: reason,
                });
            } else {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: failureContent,
                    error: reason,
                    timestamp: Date.now(),
                });
            }
        } finally {
            releaseProviderCancellation();
            setActiveAborter(null);
            setChatGenerating(false);
        }
        return undefined;
    }

    // ── Regular Chat Mode ───────────────────────────────────────────────
    const userMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: userMsgId,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
    };
    appendChatMessage(initialAssistantMessage);

    const aborter = new AbortController();
    setActiveAborter(aborter);
    const releaseProviderCancellation = agentRunCancellation.bindAbortController({
        runId,
        lease: providerLease,
        controller: aborter,
        reason: 'User cancelled the run while the provider response was active.',
    });
    const previousLlmStatus = llmStatusStore.value;
    llmStatusStore.set({ state: 'generating' });
    // Incremental think-block parser: feeding each streamed token keeps the
    // boundary scan linear instead of re-scanning the whole buffer per token.
    // It also retains the full accumulated text internally, so no separate
    // buffer is needed.
    const thinkParser = createThinkBlockParser();
    let cloudOutcome: CloudChatCompletionOutcome | null = null;
    let webLlmIncompleteReason: string | null = null;
    let providerSession: ModelProviderSession | null = null;
    let providerStreamWriter: ReturnType<typeof createModelProviderStreamWriter> | null = null;
    let providerResult: ModelProviderResult | null = null;
    let providerUsageRecorded = false;

    try {
        const workspaceContext = getProjectContext();
        const agentRun = agentRunLifecycle.get(runId);
        if (agentRun === null) {
            throw createAiRuntimeError('The agent run could not be recovered before provider planning.');
        }
        const agentContext = buildAgentContext({
            fixedPolicy: CHAT_SYSTEM_PROMPT,
            prompt: userText,
            context: workspaceContext,
            projectRevision: captureProjectRevision(),
            run: { grants: agentRun.grants, budgets: agentRun.budgets },
            receipts: (agentRun.plan?.applicationToolReceipts ?? []).map((receipt) => ({
                id: receipt.callId,
                summary: receipt.summary,
            })),
            validationFailures: agentRun.errors.map((error) => ({ code: error.code })),
            priorEvidence: agentRun.contextEvidence,
        });
        agentRunLifecycle.recordContextEvidence({ runId, evidence: agentContext.evidence });
        if (!agentContext.authorityComplete) {
            throw createAiRuntimeError('Relevant production authority exceeds the bounded context limit.');
        }
        const systemPrompt = agentContext.message;

        // Keep only the last 24 messages (12 user+assistant pairs) to avoid
        // blowing the context window on long conversations.
        const conversationHistory = chatStore
            .value!.messages.filter((message) => message.id !== assistantMsgId && !message.error)
            .slice(-24)
            .map((message) => ({
                role: message.role,
                content: message.content,
            }));

        const completionMessages: Array<{
            role: 'system' | 'user' | 'assistant';
            content: string;
        }> = [{ role: 'system', content: systemPrompt }, ...conversationHistory];
        const remoteDisclosure =
            backend === 'cloud'
                ? remoteTransmissionDisclosure.prepare({
                      categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
                      correlationId: providerReceiptIdentity,
                      requestId: providerReceiptIdentity,
                  })
                : undefined;
        const providerProtocol = createModelProviderProtocol({
            provider: getModelProviderName(backend),
            model: getBackendModelId(backend),
        });
        const compiledProviderRequest = providerProtocol.compileRequest({
            correlationId: providerReceiptIdentity,
            runId,
            requestId: providerReceiptIdentity,
            cancellationGeneration: providerLease.cancellationGeneration,
            operation: 'text',
            modality: 'text',
            messages: completionMessages,
            stream: true,
            limits: { maxOutputTokens: 2_048 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 32_768, maxOutputTokens: 2_048, maxTotalTokens: 34_816 },
            dataPolicy: backend === 'cloud' ? 'remote-allowed' : 'local-only',
            ...(remoteDisclosure === undefined
                ? {}
                : {
                      dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
                      remoteDisclosure,
                  }),
        });
        if (compiledProviderRequest.status !== 'ready') {
            throw createAiRuntimeError(compiledProviderRequest.failure.safeMessage);
        }
        const providerRequest = compiledProviderRequest.request;
        const providerEstimate = estimateCompiledProviderRequestTokenCeiling(providerRequest);
        const budgetReservation = agentRunLifecycle.reserveBudget({
            runId,
            attemptId: providerRequest.correlationId,
            category: getProviderBudgetCategory(backend),
            estimate: providerEstimate.totalTokenCeiling,
            provenance: 'versioned-estimate',
            estimateMethod: providerEstimate.method,
        });
        if (budgetReservation.status === 'hard-limit-reached') {
            agentRunLifecycle.recordError({
                runId,
                error: normalizeAgentFailure({
                    category: 'budget',
                    source: 'provider-planning',
                    related: { workIds: [providerWorkId] },
                    knownDomain: true,
                }),
                terminal: true,
            });
            throw createAiRuntimeError('The agent budget limit was reached before work started.');
        }
        if (backend === 'cloud') {
            if (
                remoteDisclosure === undefined ||
                !remoteTransmissionDisclosure.publish({
                    evidence: remoteDisclosure,
                    runId,
                    provider: getModelProviderName(backend),
                })
            ) {
                throw createAiRuntimeError('Hosted AI privacy disclosure could not be published.');
            }
            const remoteCategories = REMOTE_TEXT_AGENT_DATA_CATEGORIES;
            assertRemoteAgentDataPolicy(remoteCategories);
            appendChatMessage({
                id: `msg-${crypto.randomUUID()}`,
                role: 'assistant',
                content: formatRemoteTransmissionDisclosure(remoteCategories),
                timestamp: Date.now(),
            });
        }
        providerSession = providerProtocol.start(providerRequest);
        const activeProviderStreamWriter = createModelProviderStreamWriter(providerRequest, providerSession);
        providerStreamWriter = activeProviderStreamWriter;

        if (backend === 'cloud') {
            // Cloud: streaming completion via Claude API
            cloudOutcome = await streamCloudChatCompletion(
                providerRequest.messages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    activeProviderStreamWriter.push({ type: 'text', mode: 'delta', text: token });
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                {
                    temperature: 0.7,
                    maxTokens: providerRequest.limits.maxOutputTokens,
                    signal: aborter.signal,
                    onUsage: (event) => activeProviderStreamWriter.push(event),
                    onUnknownEvent: (providerEventType) =>
                        activeProviderStreamWriter.push({ type: 'unknown', providerEventType }),
                }
            );
        } else {
            // WebLLM: streaming completion via the in-browser engine.
            // Yield to the render loop before starting inference — the first
            // forward pass triggers WebGPU shader compilation which locks the
            // GPU (shared with the compositor). Without this yield, the browser
            // can't paint the "Thinking..." state before the GPU gets busy.
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            aborter.signal.throwIfAborted();

            const engine = getLlmEngine()!;
            function interruptWebLlm(): void {
                engine.interruptGenerate();
            }
            aborter.signal.addEventListener('abort', interruptWebLlm, { once: true });

            try {
                const asyncChunkGenerator = (await engine.chat.completions.create({
                    messages: providerRequest.messages,
                    temperature: 0.7,
                    max_tokens: providerRequest.limits.maxOutputTokens,
                    stream: true,
                })) as AsyncIterable<{
                    choices?: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
                    type?: string;
                    usage?: {
                        prompt_tokens?: number;
                        completion_tokens?: number;
                        prompt_tokens_details?: { cached_tokens?: number };
                        completion_tokens_details?: { reasoning_tokens?: number };
                    };
                }>;
                let sawTerminalReason = false;
                let sawFinalUsage = false;

                for await (const chunk of asyncChunkGenerator) {
                    if (aborter.signal.aborted) {
                        break;
                    }
                    if (sawTerminalReason && !Array.isArray(chunk.choices)) {
                        throw new Error('WebLLM stream returned an event after completion');
                    }
                    if (!Array.isArray(chunk.choices)) {
                        activeProviderStreamWriter.push({
                            type: 'unknown',
                            providerEventType: `webllm:${chunk.type ?? 'unknown'}`,
                        });
                        continue;
                    }
                    const choice = chunk.choices[0];
                    const deltaDesc = choice?.delta.content;
                    if (sawTerminalReason) {
                        if (chunk.choices.length === 0 && chunk.usage && !sawFinalUsage) {
                            activeProviderStreamWriter.push({
                                type: 'usage',
                                mode: 'final',
                                usage: {
                                    inputTokens: readProviderTokenCount(chunk.usage.prompt_tokens),
                                    outputTokens: readProviderTokenCount(chunk.usage.completion_tokens),
                                    cachedInputTokens: readProviderTokenCount(
                                        chunk.usage.prompt_tokens_details?.cached_tokens
                                    ),
                                    reasoningTokens: readProviderTokenCount(
                                        chunk.usage.completion_tokens_details?.reasoning_tokens
                                    ),
                                },
                                provenance: 'provider-reported',
                            });
                            sawFinalUsage = true;
                            continue;
                        }
                        if (deltaDesc !== undefined) {
                            throw new Error('WebLLM stream returned text after completion');
                        }
                        if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                            throw new Error('WebLLM stream returned duplicate completion');
                        }
                        throw new Error('WebLLM stream returned an event after completion');
                    }
                    if (chunk.choices.length === 0 && !chunk.usage) {
                        activeProviderStreamWriter.push({
                            type: 'unknown',
                            providerEventType: `webllm:${chunk.type ?? 'unknown'}`,
                        });
                    }
                    if (deltaDesc !== undefined) {
                        activeProviderStreamWriter.push({ type: 'text', mode: 'delta', text: deltaDesc });
                        const parsed = thinkParser.push(deltaDesc);
                        updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                    }
                    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                        sawTerminalReason = true;
                        if (choice.finish_reason !== 'stop') {
                            webLlmIncompleteReason = choice.finish_reason;
                        }
                    }
                    if (chunk.usage) {
                        activeProviderStreamWriter.push({
                            type: 'usage',
                            mode: 'final',
                            usage: {
                                inputTokens: readProviderTokenCount(chunk.usage.prompt_tokens),
                                outputTokens: readProviderTokenCount(chunk.usage.completion_tokens),
                                cachedInputTokens: readProviderTokenCount(
                                    chunk.usage.prompt_tokens_details?.cached_tokens
                                ),
                                reasoningTokens: readProviderTokenCount(
                                    chunk.usage.completion_tokens_details?.reasoning_tokens
                                ),
                            },
                            provenance: 'provider-reported',
                        });
                        sawFinalUsage = true;
                    }
                }
                if (!aborter.signal.aborted && !sawTerminalReason) {
                    throw new Error('WebLLM chat stream ended unexpectedly');
                }
            } finally {
                aborter.signal.removeEventListener('abort', interruptWebLlm);
            }
        }

        if (aborter.signal.aborted) {
            throw aborter.signal.reason;
        }

        let providerFinish: ModelProviderFinish = { reason: 'stop' };
        if (cloudOutcome?.status === 'incomplete') {
            providerFinish =
                cloudOutcome.reason === 'length' || cloudOutcome.reason === 'token limit'
                    ? { reason: 'length' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'incomplete-output',
                              retryable: true,
                              safeMessage: 'The hosted provider returned an incomplete response.',
                          },
                      };
        } else if (webLlmIncompleteReason !== null) {
            providerFinish =
                webLlmIncompleteReason === 'length'
                    ? { reason: 'length' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'incomplete-output',
                              retryable: true,
                              safeMessage: 'WebLLM returned an incomplete response.',
                          },
                      };
        }
        providerResult = activeProviderStreamWriter.finish(providerFinish);

        // Strip <think>…</think> reasoning block before storing the final message.
        const { reasoning, content: cleanContent } = thinkParser.snapshot();
        const incompleteFailure =
            providerResult.failure !== null &&
            (providerResult.status === 'partial' || providerResult.status === 'failed')
                ? providerResult.failure
                : null;
        const incompleteReason =
            incompleteFailure?.code === 'output-limit' ? 'length' : (incompleteFailure?.code ?? null);
        const incompleteNotice =
            incompleteFailure === null ? '' : `\n\n_Response incomplete: ${incompleteFailure.safeMessage}_`;
        const incompleteProviderLabel = getProviderDisplayName(backend);
        const incompleteError =
            incompleteReason === null
                ? undefined
                : `${incompleteProviderLabel} response incomplete (${incompleteReason})`;
        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            content: `${cleanContent}${incompleteNotice}`,
            reasoning,
            error: incompleteError,
        });
        agentRunWorkLease.settle({
            runId,
            workId: providerWorkId,
            leaseId: providerLease.leaseId,
            cancellationGeneration: providerLease.cancellationGeneration,
            idempotencyKey: providerLease.idempotencyKey,
            receiptIdentity: providerLease.receiptIdentity,
            terminalState: 'completed',
        });
        recordModelProviderUsage(runId, providerResult, providerReceiptIdentity, { terminal: true });
        providerUsageRecorded = true;
        agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
        llmStatusStore.set({ state: 'ready', backend, modelId: getBackendModelId(backend) });
    } catch (error) {
        const errorMessage = (() => {
            if (isAppError(error)) {
                return error.message;
            }
            if (error instanceof Error) {
                return error.message;
            }
            return 'An unknown error occurred during generation.';
        })();
        const configurationChanged = isAiRuntimeConfigurationChangedError(error);
        const wasAborted =
            configurationChanged ||
            aborter.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError') ||
            errorMessage === 'AbortedByUser' ||
            errorMessage.includes('AbortError');
        if (providerSession && providerStreamWriter && !providerResult) {
            providerResult = providerStreamWriter.finish(
                wasAborted
                    ? { reason: 'cancelled' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'provider-stream-failed',
                              retryable: true,
                              safeMessage: 'The model provider request failed.',
                          },
                      }
            );
        }
        if (providerResult && !providerUsageRecorded) {
            recordModelProviderUsage(runId, providerResult, providerReceiptIdentity, { terminal: true });
            providerUsageRecorded = true;
        }
        if (configurationChanged) {
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            trySettleAgentRunWorkLease(providerLease, 'cancelled');
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            });
            llmStatusStore.set({ state: 'idle' });
            return undefined;
        }
        if (!wasAborted) {
            agentRunWorkLease.settle({
                runId,
                workId: providerWorkId,
                leaseId: providerLease.leaseId,
                cancellationGeneration: providerLease.cancellationGeneration,
                idempotencyKey: providerLease.idempotencyKey,
                receiptIdentity: providerLease.receiptIdentity,
                terminalState: 'failed',
            });
        }
        if (wasAborted) {
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            // Clean abort, leave generated partial content intact and strip parsing blocks
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
            });
            const currentPreference = aiBackendPreferenceStore.value ?? 'auto';
            if (currentPreference !== 'auto' && currentPreference !== backend) {
                llmStatusStore.set({ state: 'idle' });
            } else if (
                previousLlmStatus?.state === 'ready' &&
                previousLlmStatus.backend === 'cloud' &&
                !isCloudAvailable()
            ) {
                llmStatusStore.set({ state: 'idle' });
            } else {
                llmStatusStore.set(previousLlmStatus ?? { state: 'idle' });
            }
        } else {
            agentRunLifecycle.recordError({
                runId,
                error: normalizeAgentFailure({
                    category: 'provider',
                    source: 'provider-planning',
                    retry: 'read-only',
                    knownDomain: false,
                }),
                terminal: true,
            });
            const parsed = thinkParser.snapshot();
            const hasPartialContent = parsed.content.length > 0 || (parsed.reasoning?.length ?? 0) > 0;
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                error: errorMessage,
                content: hasPartialContent
                    ? `${parsed.content}\n\n_Response incomplete because the provider stream failed._`
                    : 'Sorry, I encountered an error while thinking about that.',
                reasoning: parsed.reasoning,
            });
            llmStatusStore.set({ state: 'error', message: errorMessage });
        }
    } finally {
        releaseProviderCancellation();
        setActiveAborter(null);
        setChatGenerating(false);
    }
    return undefined;
}
