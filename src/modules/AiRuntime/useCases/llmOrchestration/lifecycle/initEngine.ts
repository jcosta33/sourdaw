import { logger } from '#/infra/logger/appLogger';

import { createAiRuntimeError } from '../../../errors/AiRuntimeError';
import { initNativeEngine } from '../../../repositories/nativeEngine/initNativeEngine';
import { getActiveModelId } from '../../../repositories/webLlm/getActiveModelId';
import { initWebLlmEngine } from '../../../repositories/webLlm/initWebLlmEngine';
import { engineInitializationState } from '../../../stores/engineInitializationState';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { getBackendChain } from '../backendResolution/getBackendChain';

/**
 * Initialize the selected backend plan. Explicit preferences contain one
 * backend; automatic mode may contain ordered fallbacks.
 */
export async function initEngine(modelId?: string): Promise<void> {
    const controller = engineInitializationState.begin();
    const backends = getBackendChain();

    try {
        if (backends.length === 0) {
            llmStatusStore.set({ state: 'error', message: 'No AI backend available' });
            throw createAiRuntimeError(
                'No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.'
            );
        }

        let lastError: Error | null = null;

        for (const backend of backends) {
            llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });
            try {
                if (backend === 'native') {
                    await initNativeEngine({ signal: controller.signal });
                    if (controller.signal.aborted) {
                        return;
                    }
                    llmStatusStore.set({ state: 'ready', backend: 'native', modelId: 'native' });
                    return;
                }

                if (backend === 'webllm') {
                    await initWebLlmEngine(modelId, { signal: controller.signal });
                    if (controller.signal.aborted) {
                        return;
                    }
                    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: getActiveModelId() });
                    return;
                }

                if (controller.signal.aborted) {
                    return;
                }
                llmStatusStore.set({ state: 'idle' });
                return;
            } catch (error) {
                if (controller.signal.aborted) {
                    return;
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
