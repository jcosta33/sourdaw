/**
 * Native LLM engine lifecycle.
 *
 * In Tauri: loads the model in-process via mistral.rs (auto-downloads from HuggingFace on first use).
 * In browser dev mode: connects to a manually-started llama-server on localhost.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';
import { llmStatusStore } from '../../stores/llmStatusStore';

export const SIDECAR_PORT = parseInt((import.meta.env.VITE_LLM_SIDECAR_PORT as string | undefined) ?? '8847', 10);
export const BASE_URL = `http://127.0.0.1:${String(SIDECAR_PORT)}`;

let nativeEngineReady = false;

async function checkLlamaServerHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

export const initNativeEngine = inject({ logger })(
    ({ logger }) =>
        async function initNativeEngine(): Promise<void> {
            if (isTauri()) {
                llmStatusStore.set({
                    state: 'loading',
                    progress: 0,
                    text: 'Starting AI engine…',
                });

                // Listen for real progress events from Rust
                let unlisten: (() => void) | null = null;
                try {
                    const { tauriListen } = await import('#/utils/tauriBridge');
                    unlisten = await tauriListen('llm-progress', (event: unknown) => {
                        const payload = (event as { payload: { progress: number; text: string } }).payload;
                        if (payload) {
                            llmStatusStore.set({
                                state: 'loading',
                                progress: payload.progress,
                                text: payload.text,
                            });
                        }
                    });
                } catch {
                    // Listener setup failed — progress will just stay at initial message
                }

                try {
                    await tauriInvoke('init_native_llm', { modelId: null });
                } catch (error) {
                    if (unlisten) {
                        unlisten();
                    }
                    const msg = error instanceof Error ? error.message : String(error);
                    llmStatusStore.set({ state: 'error', message: msg });
                    throw error;
                }

                if (unlisten) {
                    unlisten();
                }
                nativeEngineReady = true;
                logger.info('[Native AI] In-process LLM ready');
                return;
            }

            // Browser dev mode: fall back to external llama-server
            logger.info('[Native AI] Browser mode — checking if llama-server is running...');
            const healthy = await checkLlamaServerHealth();
            if (healthy) {
                nativeEngineReady = true;
                logger.info(`[Native AI] Connected to llama-server on port ${String(SIDECAR_PORT)}`);
                return;
            }

            throw new Error(
                `llama-server not reachable at ${BASE_URL}. ` +
                    `Start it manually: llama-server --model <path-to-gguf> --port ${String(SIDECAR_PORT)} --host 127.0.0.1 --n-gpu-layers 99`
            );
        }
);

export const stopNativeEngine = inject({ logger })(
    ({ logger }) =>
        async function stopNativeEngine(): Promise<void> {
            if (isTauri()) {
                await tauriInvoke('unload_native_llm');
            }
            nativeEngineReady = false;
            logger.info('[Native AI] Engine stopped');
        }
);

export function isNativeEngineReady(): boolean {
    return nativeEngineReady;
}
