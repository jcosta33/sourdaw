import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';
import { type AgentRunBudgets, type AgentRunDecisionResume } from '../models/AgentRun';
import { isCloudAvailable } from '../repositories/cloudLlm/isCloudAvailable';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import { chatStore } from '../stores/chatStore';

import { type executeImmediatePromptCommand } from './agentRequestOrchestration/executeImmediatePromptCommand';
import { orchestratePromptChatRequest } from './agentRequestOrchestration/orchestratePromptChatRequest';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { resolveAgentExecutionMode } from './resolveAgentExecutionMode';

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
    const backend = resolveBackend({ operation: 'tools', modality: 'text', streaming: false });
    // Explain has no deterministic action fallback, so unavailable providers fail before admission.
    if (interactionMode === 'explain') {
        if (backend === 'none') {
            throw createAiRuntimeError(
                'No AI backend available. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
            );
        }
        if (backend === 'webllm' && !getLlmEngine()) {
            throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
        }
        if (backend === 'cloud' && !isCloudAvailable()) {
            throw createAiRuntimeError('Hosted AI is not configured.');
        }
    }
    return orchestratePromptChatRequest({ userText, requestedRoute, backend, interactionMode, options });
}
