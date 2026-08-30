import { logger } from '#/infra/logger/appLogger';
import { settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';
import { type AgentRunBudgets, type AgentRunDecisionResume } from '../models/AgentRun';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type ModelProviderName } from '../models/ModelProviderProtocol';
import { getCloudProviderInfo } from '../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../repositories/cloudLlm/isCloudAvailable';
import { getActiveModelId } from '../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import { chatStore, setChatGenerating } from '../stores/chatStore';

import { type executeImmediatePromptCommand } from './agentRequestOrchestration/executeImmediatePromptCommand';
import { orchestratePromptChatRequest } from './agentRequestOrchestration/orchestratePromptChatRequest';
import { settleAgentRunWorkLeaseSafely } from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { streamExplainChatResponse } from './agentRequestOrchestration/streamExplainChatResponse';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
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

type AgentApplyReceipt = NonNullable<Awaited<ReturnType<typeof executeImmediatePromptCommand>>>;

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
    if (interactionMode !== 'explain') {
        return orchestratePromptChatRequest({ userText, requestedRoute, backend, interactionMode, options });
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
    const providerWorkId = 'provider-response';
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
    return streamExplainChatResponse({
        userText,
        runId,
        backend,
        providerLease,
        providerReceiptIdentity,
        providerWorkId,
    });
}
