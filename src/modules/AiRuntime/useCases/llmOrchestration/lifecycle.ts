import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { llmStatusStore } from '../../stores/llmStatusStore';
import {
    initLlamaServer,
    isLlamaServerRunning,
    stopLlamaServer,
} from '../../repositories/llamaServerEngine';
import {
    initWebLlmEngine,
    unloadWebLlmEngine,
} from '../../repositories/webLlm';
import { isCloudAvailable } from '../../repositories/cloudLlm';
import { resolveBackend } from './backendResolution';

const logger = Container.getInstance().get(Logger);

/**
 * Initialize the auto-detected backend. Throws on failure.
 */
export async function initEngine(): Promise<void> {
    const backend = resolveBackend();

    if (backend === 'none') {
        llmStatusStore.set({ state: 'error', message: 'No AI backend available' });
        throw new Error('No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.');
    }

    llmStatusStore.set({ state: 'loading', progress: 0, text: `Starting ${backend} engine...` });

    if (backend === 'native') {
        try {
            await initLlamaServer();
            llmStatusStore.set({ state: 'ready', modelId: 'native' });
            return;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`[AI Engine] Native AI backend failed: ${msg}`);
            logger.warn('[AI Engine] Install llama-server or place the binary at src-tauri/binaries/llama-server-{target-triple}');

            if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
                logger.info('[AI Engine] Falling back to WebLLM...');
                llmStatusStore.set({ state: 'loading', progress: 0, text: 'Native AI unavailable — loading WebLLM...' });
                await initWebLlmEngine();
                return;
            }

            if (isCloudAvailable()) {
                logger.info('[AI Engine] Falling back to cloud AI...');
                llmStatusStore.set({ state: 'ready', modelId: 'claude' });
                return;
            }

            llmStatusStore.set({ state: 'error', message: 'Native AI engine not available. Install llama-server to enable AI features.' });
            throw new Error(`Native AI engine failed: ${msg}. No fallback available.`);
        }
    }

    if (backend === 'cloud') {
        llmStatusStore.set({ state: 'ready', modelId: 'claude' });
        return;
    }

    await initWebLlmEngine();
}

/**
 * Unload the current engine and free memory.
 */
export async function unloadEngine(): Promise<void> {
    if (isLlamaServerRunning()) {
        await stopLlamaServer();
    }
    unloadWebLlmEngine();
    llmStatusStore.set({ state: 'idle' });
}
