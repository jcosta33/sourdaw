import { logger } from '#/infra/logger/appLogger';

import { llmStatusStore } from '../../stores/llmStatusStore';
import { initNativeEngine, isNativeEngineReady, stopNativeEngine } from '../../repositories/nativeEngine/lifecycle';
import { initWebLlmEngine, unloadWebLlmEngine } from '../../repositories/webLlm/engineLifecycle';
import { isCloudAvailable } from '../../repositories/cloudLlm/keyManagement';
import { resolveBackend } from './backendResolution';

/**
 * Initialize the auto-detected backend. Throws on failure.
 */
export async function initEngine(modelId?: string): Promise<void> {
    const backend = resolveBackend();

    if (backend === 'none') {
        llmStatusStore.set({ state: 'error', message: 'No AI backend available' });
        throw new Error('No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.');
    }

    llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });

    if (backend === 'native') {
        try {
            await initNativeEngine();
            llmStatusStore.set({ state: 'ready', modelId: 'native' });
            return;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`[AI Engine] Native AI backend failed: ${msg}`);

            if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
                logger.info('[AI Engine] Falling back to WebLLM...');
                llmStatusStore.set({
                    state: 'loading',
                    progress: 0,
                    text: 'Native AI unavailable — loading WebLLM...',
                });
                await initWebLlmEngine(modelId);
                return;
            }

            if (isCloudAvailable()) {
                logger.info('[AI Engine] Falling back to cloud AI...');
                llmStatusStore.set({ state: 'ready', modelId: 'claude' });
                return;
            }

            llmStatusStore.set({ state: 'error', message: 'Native AI engine failed to load. Check logs for details.' });
            throw new Error(`Native AI engine failed: ${msg}. No fallback available.`);
        }
    }

    if (backend === 'cloud') {
        llmStatusStore.set({ state: 'ready', modelId: 'claude' });
        return;
    }

    await initWebLlmEngine(modelId);
}

/**
 * Unload the current engine and free memory.
 */
export async function unloadEngine(): Promise<void> {
    if (isNativeEngineReady()) {
        await stopNativeEngine();
    }
    unloadWebLlmEngine();
    llmStatusStore.set({ state: 'idle' });
}
