import { type RunnableAiBackend } from '../../models/LlmOrchestrationTypes';
import { getCloudProviderInfo } from '../../repositories/cloudLlm/getCloudProviderInfo';
import { getActiveModelId } from '../../repositories/webLlm/getActiveModelId';
import { type LlmEngineStatus } from '../../stores/llmStatusStore';

/** The generating status naming the backend, provider and model one attempt is sent to. */
export function readAnsweringStatus(backend: RunnableAiBackend): Extract<LlmEngineStatus, { state: 'generating' }> {
    if (backend === 'webllm') {
        return { state: 'generating', backend, modelId: getActiveModelId() };
    }
    // The same fallbacks the provider protocol is created with, so the badge names what is asked.
    const hosted = getCloudProviderInfo();
    return {
        state: 'generating',
        backend,
        provider: hosted?.provider ?? 'openai-compatible',
        modelId: hosted?.model ?? 'cloud',
    };
}
