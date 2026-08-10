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

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';
import { BASE_URL, nativeEngineState, SIDECAR_PORT } from './lifecycleState';

async function checkLlamaServerHealth(signal?: AbortSignal): Promise<boolean> {
    try {
        const timeoutSignal = AbortSignal.timeout(2000);
        const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        const response = await fetch(`${BASE_URL}/health`, { signal: requestSignal });
        return response.ok;
    } catch {
        return false;
    }
}

type InitNativeEngineOptions = {
    signal?: AbortSignal;
};

const MAX_PROGRESS_TEXT_LENGTH = 512;

export const initNativeEngine = inject({ logger })(
    ({ logger }) =>
        async function initNativeEngine(options: InitNativeEngineOptions = {}): Promise<void> {
            options.signal?.throwIfAborted();
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
                        if (options.signal?.aborted) {
                            return;
                        }
                        const payload =
                            typeof event === 'object' && event !== null && 'payload' in event ? event.payload : null;
                        if (
                            typeof payload === 'object' &&
                            payload !== null &&
                            'progress' in payload &&
                            'text' in payload &&
                            typeof payload.progress === 'number' &&
                            Number.isFinite(payload.progress) &&
                            payload.progress >= 0 &&
                            payload.progress <= 1 &&
                            typeof payload.text === 'string' &&
                            payload.text.length <= MAX_PROGRESS_TEXT_LENGTH
                        ) {
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

                if (options.signal?.aborted) {
                    unlisten?.();
                    options.signal.throwIfAborted();
                }

                const requestId = crypto.randomUUID();
                try {
                    await invokeCancelableNativeLlm({
                        command: 'init_native_llm',
                        args: { modelId: null },
                        requestId,
                        signal: options.signal,
                        abortMessage: 'Native initialization aborted',
                    });
                    options.signal?.throwIfAborted();
                    const finalized = await tauriInvoke('finalize_native_llm_initialization', { requestId });
                    options.signal?.throwIfAborted();
                    if (!isLoadedNativeLlmStatus(finalized)) {
                        throw new Error('Native initialization could not commit a loaded model');
                    }
                    nativeEngineState.ready = true;
                    logger.info('[Native AI] In-process LLM ready');
                    return;
                } catch (error) {
                    if (options.signal?.aborted) {
                        void tauriInvoke('unload_native_llm_if_owned', { requestId }).catch((cleanupError: unknown) => {
                            logger.warn(
                                `[Native AI] Failed to clean up cancelled initialization: ${String(cleanupError)}`
                            );
                        });
                        options.signal.throwIfAborted();
                    }
                    const msg = error instanceof Error ? error.message : String(error);
                    llmStatusStore.set({ state: 'error', message: msg });
                    throw error;
                } finally {
                    unlisten?.();
                }
            }

            // Browser dev mode: fall back to external llama-server
            logger.info('[Native AI] Browser mode — checking if llama-server is running...');
            const healthy = await checkLlamaServerHealth(options.signal);
            options.signal?.throwIfAborted();
            if (healthy) {
                nativeEngineState.ready = true;
                logger.info(`[Native AI] Connected to llama-server on port ${String(SIDECAR_PORT)}`);
                return;
            }

            throw new Error(
                `llama-server not reachable at ${BASE_URL}. ` +
                    `Start it manually: llama-server --model <path-to-gguf> --port ${String(SIDECAR_PORT)} --host 127.0.0.1 --n-gpu-layers 99`
            );
        }
);

function isLoadedNativeLlmStatus(value: unknown): value is { loaded: true; modelId: string | null } {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'loaded' in value &&
        value.loaded === true &&
        'modelId' in value &&
        (typeof value.modelId === 'string' || value.modelId === null)
    );
}
