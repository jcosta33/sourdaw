import { logger } from '#/infra/logger/appLogger';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision, settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';
import { type AgentRunBudgets, type AgentRunDecisionResume, type AgentRunScope } from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ExecutableRuntimeAction } from '../models/ExecutableRuntimeAction';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type ModelProviderName } from '../models/ModelProviderProtocol';
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
import { proposePendingActionConfirmation } from '../stores/pendingActionConfirmationStore';
import { getAgentPlanProposalIdentity } from '../transformers/normalizeAgentPlanProposal';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { createStemImportConfirmationResourceLease } from './agentReference/createStemImportConfirmationResourceLease';
import { executeImmediatePromptCommand } from './agentRequestOrchestration/executeImmediatePromptCommand';
import {
    AGENT_RUN_STALE_COMPLETION_WARNING,
    settleAgentRunWorkLeaseSafely,
} from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { streamExplainChatResponse } from './agentRequestOrchestration/streamExplainChatResponse';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { ApplicationOwnedToolLoopRequestError } from './applicationOwnedToolLoop';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentActionExecution } from './compileAgentActionExecution';
import { describeAgentRiskApproval } from './describeAgentRiskApproval';
import { describePendingActionConfirmation } from './describePendingActionConfirmation';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { planAgentRun } from './planAgentRun';
import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { planPromptActions } from './planPromptActions';
import { recordAgentProviderUsage } from './recordAgentProviderUsage';
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

type AgentApplyReceipt = NonNullable<Awaited<ReturnType<typeof executeImmediatePromptCommand>>>;

function tryRecordTerminalFailure(input: Parameters<typeof agentRunLifecycle.recordError>[0]): void {
    try {
        agentRunLifecycle.recordError(input);
    } catch {
        // The user-visible failure remains authoritative when its recovery record cannot persist.
    }
}

function appendSettlementWarning(content: string, warning: string | null): string {
    return warning ? `${content}\n\n_${warning}_` : content;
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

/**
 * The ids this batch mints for objects that do not exist yet. The compiled envelope records them as
 * the `targets-absent` precondition, so a provider proposal authored before compilation cannot name
 * them and the plan's scope comparison must not demand it.
 */
function getApplicationAssignedTargetIds(
    envelope: Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope']
): string[] {
    return envelope.preconditions.flatMap((precondition) =>
        precondition.kind === 'targets-absent' ? [...(precondition.targetIds ?? [])] : []
    );
}

type ProviderKnownScopeInput = {
    readonly targetRanges: readonly Readonly<AgentRunScope['targetRanges'][number]>[];
    readonly protectedTargetIds: readonly string[];
    readonly protectedRanges: readonly Readonly<AgentRunScope['protectedRanges'][number]>[];
};

function getProviderKnownScope(
    scope: ProviderKnownScopeInput,
    providerKnownTargetIds: readonly string[] | undefined
): AgentRunScope | undefined {
    if (providerKnownTargetIds === undefined) {
        return undefined;
    }
    return {
        targetIds: [...providerKnownTargetIds],
        targetRanges: scope.targetRanges.map((range) => ({ ...range })),
        protectedTargetIds: [...scope.protectedTargetIds],
        protectedRanges: scope.protectedRanges.map((range) => ({ ...range })),
    };
}

const SELECTED_STEM_ASSETS_READY_ID = 'selected-stem-assets';

function getApplicationReadyAssetIdsForPlan(runId: string, actions: readonly ExecutableRuntimeAction[]): string[] {
    const selectedStems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    const selectedStemAssetIds = selectedStems.map((stem) => stem.audioBufferId);
    if (selectedStemAssetIds.length === 0) {
        return [];
    }

    const livePreparedStemAssetIds = new Set(
        agentRunLifecycle
            .get(runId)
            ?.temporaryAssets.flatMap((asset) =>
                asset.kind === 'import' && asset.status === 'live' ? [asset.assetId] : []
            ) ?? []
    );
    if (
        livePreparedStemAssetIds.size !== selectedStemAssetIds.length ||
        selectedStemAssetIds.some((assetId) => !livePreparedStemAssetIds.has(assetId))
    ) {
        return [];
    }

    return [SELECTED_STEM_ASSETS_READY_ID, ...new Set(selectedStems.map((stem) => stem.stemId))];
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
        createdRevision: settlePendingProjectWritesAndCaptureRevision(),
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
        settleAgentRunWorkLeaseSafely({
            lease: providerLease,
            terminalState: 'failed',
            evidence: 'none',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(new Error('Resumed provider work lease settlement failed', { cause: settlementError })),
        });
        try {
            agentRunLifecycle.transitionPhase({ runId, phase: 'failed' });
        } catch (lifecycleError) {
            logger.error(new Error('Resumed agent run lifecycle persistence failed', { cause: lifecycleError }));
        }
        throw error;
    }

    setChatGenerating(true);

    // ── Prompt Command Mode ──────────────────────────────────────────────
    if (interactionMode !== 'explain') {
        const aborter = new AbortController();
        let prompt_assistant_message_id: string | null = null;
        let providerPlanningLeaseSettled = false;
        let commandExecutionSettlementWarning: string | null = null;
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
                    recordAgentProviderUsage(runId, providerResult, providerResult.correlationId);
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
            const providerPlanningSettlement = settleAgentRunWorkLeaseSafely({
                lease: providerLease,
                terminalState: 'completed',
                evidence: 'none',
                settle: agentRunWorkLease.settle,
                reportFailure: (settlementError) =>
                    logger.error(
                        new Error('Completed provider planning work lease settlement failed', {
                            cause: settlementError,
                        })
                    ),
            });
            if (!providerPlanningSettlement.accepted || providerPlanningSettlement.warning !== null) {
                const warning = providerPlanningSettlement.warning ?? AGENT_RUN_STALE_COMPLETION_WARNING;
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
                return undefined;
            }
            providerPlanningLeaseSettled = true;

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
                const readyAssetIds = getApplicationReadyAssetIdsForPlan(runId, result.actions);
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
                    const plannedCommandBatch = compileAgentActionExecution({
                        actions: result.actions,
                        actionCommandGraph: result.actionCommandGraph,
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
                    }).commandBatch;
                    const plannedAuthority = plannedCommandBatch.authority;
                    const parsedPlannedBatch = parseVersionedCommandBatchEnvelope(
                        plannedCommandBatch.serialized,
                        plannedAuthority
                    );
                    if (parsedPlannedBatch.status === 'invalid') {
                        throw new Error(parsedPlannedBatch.reason);
                    }
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
                        providerKnownScope: getProviderKnownScope(planScope, result.providerKnownTargetIds),
                        requireProviderProposal: result.executionMode === 'atomic',
                        applicationAssignedTargetIds: getApplicationAssignedTargetIds(parsedPlannedBatch.envelope),
                        readyAssetIds,
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
                    actionCommandGraph: result.actionCommandGraph,
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
                const admittedRun = agentRunLifecycle.get(runId);
                if (!admittedRun) {
                    throw new Error('Agent run disappeared before plan materialization.');
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
                    budgets: admittedRun.budgets,
                    requiresConfirmation: compiledActionExecution.requiresConfirmation,
                    applicationToolReceipts: result.applicationToolReceipts,
                    providerProposal: result.providerProposal,
                    providerKnownScope: getProviderKnownScope(
                        commandBatch.authority.scope,
                        result.providerKnownTargetIds
                    ),
                    requireProviderProposal: result.executionMode === 'atomic',
                    applicationAssignedTargetIds: getApplicationAssignedTargetIds(parsedCommandBatch.envelope),
                    readyAssetIds,
                });
                if (plannedRun.status === 'needs-user-decision') {
                    options?.onResumedPlanAccepted?.();
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
                    budgets: admittedRun.budgets,
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
                    const resourceLease = createStemImportConfirmationResourceLease(runId, result.actions);
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
                        settleAgentRunWorkLeaseSafely({
                            lease: previewLeaseResult.lease,
                            terminalState: 'failed',
                            evidence: 'none',
                            settle: agentRunWorkLease.settle,
                        });
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
                        const settlement = settleAgentRunWorkLeaseSafely({
                            lease: previewLeaseResult.lease,
                            terminalState: 'completed',
                            evidence: 'visible-work-output',
                            settle: agentRunWorkLease.settle,
                            reportFailure: (settlementError) =>
                                logger.error(
                                    new Error('Preview work lease settlement failed', { cause: settlementError })
                                ),
                        });
                        if (!settlement.accepted) {
                            const currentRun = agentRunLifecycle.get(runId);
                            if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                                return undefined;
                            }
                            throw new Error('Agent preview work could not be settled');
                        }
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            error: settlement.warning ?? undefined,
                            content: appendSettlementWarning(
                                `Previewed without changing the project:\n\n${confirmationDescription.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                                settlement.warning
                            ),
                        });
                        try {
                            agentRunLifecycle.updateBatchStatus({
                                runId,
                                batchId: parsedCommandBatch.envelope.batchId,
                                status: 'previewed',
                            });
                        } catch (batchPersistenceError) {
                            logger.error(
                                new Error('Preview batch persistence failed', { cause: batchPersistenceError })
                            );
                        }
                        if (settlement.warning === null) {
                            try {
                                agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                            } catch (lifecyclePersistenceError) {
                                logger.error(
                                    new Error('Preview lifecycle persistence failed', {
                                        cause: lifecyclePersistenceError,
                                    })
                                );
                            }
                        }
                        return undefined;
                    }
                    const previewSettlement = settleAgentRunWorkLeaseSafely({
                        lease: previewLeaseResult.lease,
                        terminalState: preview.status === 'cancelled' ? 'cancelled' : 'failed',
                        evidence: 'none',
                        settle: agentRunWorkLease.settle,
                    });
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
                            `stem-promotion:${confirmationId}`,
                            runId
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

                return await executeImmediatePromptCommand({
                    runId,
                    prompt: userText,
                    actions: result.actions,
                    assistantMessageId: assistantMsgId,
                    abortController: aborter,
                    projectRevision,
                    executionMode: result.executionMode,
                    group: commandGroup,
                    commandBatch,
                    parsedCommandBatch,
                    onExecutionSettlementWarning: (warning) => {
                        commandExecutionSettlementWarning = warning;
                    },
                });
            } else if (result.rejectionReason) {
                tryRecordTerminalFailure({
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
            let settlementWarning: string | null = commandExecutionSettlementWarning;
            if (aborter.signal.aborted || configurationChanged || proposalInvalidated) {
                await agentRunCancellation.cancel({ runId, reason });
            } else {
                if (providerPlanningLeaseSettled) {
                    tryRecordTerminalFailure({
                        runId,
                        error: normalizeAgentFailure({
                            category: 'internal',
                            source: 'provider-planning',
                            knownDomain: false,
                        }),
                        terminal: true,
                    });
                } else {
                    const providerPlanningFailureSettlement = settleAgentRunWorkLeaseSafely({
                        lease: providerLease,
                        terminalState: 'failed',
                        evidence: 'none',
                        settle: agentRunWorkLease.settle,
                        reportFailure: (settlementError) =>
                            logger.error(
                                new Error('Failed provider planning work lease settlement failed', {
                                    cause: settlementError,
                                })
                            ),
                    });
                    settlementWarning = providerPlanningFailureSettlement.warning;
                    if (providerPlanningFailureSettlement.accepted) {
                        tryRecordTerminalFailure({
                            runId,
                            error: normalizeAgentFailure({
                                category: 'internal',
                                source: 'provider-planning',
                                knownDomain: false,
                            }),
                            terminal: true,
                        });
                    }
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
            if (prompt_assistant_message_id) {
                updateChatMessage(prompt_assistant_message_id, {
                    isStreaming: false,
                    content: promptAssistantFailureContent,
                    error: failureError,
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
                    content: failureContentWithWarning,
                    error: failureError,
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

    return streamExplainChatResponse({
        userText,
        runId,
        backend,
        providerLease,
        providerReceiptIdentity,
        providerWorkId,
    });
}
