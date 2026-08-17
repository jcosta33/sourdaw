import { logger } from '#/infra/logger/appLogger';

import { createAiRuntimeError } from '../../../errors/AiRuntimeError';
import { type AiBackend } from '../../../models/LlmOrchestrationTypes';
import { getActiveModelId } from '../../../repositories/webLlm/getActiveModelId';
import { initWebLlmEngine } from '../../../repositories/webLlm/initWebLlmEngine';
import { engineInitializationState } from '../../../stores/engineInitializationState';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { getBackendChain } from '../backendResolution/getBackendChain';

/**
 * Initialize the selected backend plan. Explicit preferences contain one
 * backend; automatic mode may contain ordered fallbacks.
 */
type InitEngineOptions = {
    webLlmDownloadConsent?: boolean;
};

export async function initEngine(modelId?: string, options: InitEngineOptions = {}): Promise<AiBackend> {
    const controller = engineInitializationState.begin();
    const backends = getBackendChain();

    try {
        if (backends.length === 0) {
            llmStatusStore.set({ state: 'error', message: 'No AI backend available' });
            throw createAiRuntimeError(
                'No AI backend available. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
            );
        }

        let lastError: Error | null = null;

        for (const backend of backends) {
            llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });
            try {
                if (backend === 'webllm') {
                    await initWebLlmEngine(modelId, {
                        downloadConsent: options.webLlmDownloadConsent,
                        signal: controller.signal,
                    });
                    if (controller.signal.aborted) {
                        return 'none';
                    }
                    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: getActiveModelId() });
                    return 'webllm';
                }

                if (controller.signal.aborted) {
                    return 'none';
                }
                llmStatusStore.set({ state: 'idle' });
                return 'cloud';
            } catch (error) {
                if (controller.signal.aborted) {
                    return 'none';
                }
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(`[AI Engine] ${backend} backend failed: ${lastError.message}`);
            }
        }

        const message = lastError?.message ?? 'Unknown initialization failure';
        llmStatusStore.set({ state: 'error', message: `AI engine failed to load: ${message}` });
        throw createAiRuntimeError(`AI engine failed to load: ${message}`);
    } finally {
        engineInitializationState.finish(controller);
    }
}
