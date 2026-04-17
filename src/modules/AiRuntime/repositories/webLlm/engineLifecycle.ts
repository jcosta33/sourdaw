import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { DEFAULT_WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { llmStatusStore } from '../../stores/llmStatusStore';

/**
 * WebLLM engine type — resolved dynamically to avoid loading the 6.2MB
 * WebLLM bundle on the main thread at import time.
 */
type WebLlmEngine = {
    chat: {
        completions: {
            create: (params: Record<string, unknown>) => Promise<unknown>;
        };
    };
};

// §67.2 — Coalesce 4 module-level \`let\`s into one holder so the WebLLM
// engine lifecycle lives behind a single named handle.
const engineState: {
    engine: WebLlmEngine | null;
    initPromise: Promise<WebLlmEngine> | null;
    worker: Worker | null;
    activeModelId: string;
} = {
    engine: null,
    initPromise: null,
    worker: null,
    activeModelId: DEFAULT_WEBLLM_MODEL_ID,
};

export function getActiveModelId(): string {
    return engineState.activeModelId;
}

export const initWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function initWebLlmEngine(modelId?: string): Promise<WebLlmEngine> {
            const targetModel = modelId ?? engineState.activeModelId;

            // If already loaded with the same model, return immediately
            if (engineState.engine && targetModel === engineState.activeModelId) {
                return Promise.resolve(engineState.engine);
            }

            // If switching models, unload the current one first
            if (engineState.engine && targetModel !== engineState.activeModelId) {
                unloadWebLlmEngine();
            }

            if (engineState.initPromise && targetModel === engineState.activeModelId) {
                return engineState.initPromise;
            }

            engineState.activeModelId = targetModel;

            // WebGPU is required — absent on Linux (WebKitGTK) and older browsers
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                return Promise.reject(
                    new Error('WebGPU not available — WebLLM requires WebGPU. Use native or cloud backend instead.')
                );
            }

            engineState.initPromise = (async () => {
                llmStatusStore.set({ state: 'loading', progress: 0, text: 'Loading AI engine...' });

                // Dynamic import — avoids loading the 6.2MB WebLLM bundle at app startup.
                // The bundle is only fetched when the user actually requests model loading.
                const [{ CreateWebWorkerMLCEngine }, { default: LlmWorker }] = await Promise.all([
                    import('@mlc-ai/web-llm'),
                    import('../llmWorker?worker'),
                ]);

                const worker = new LlmWorker();
                engineState.worker = worker;

                const created = await CreateWebWorkerMLCEngine(
                    worker,
                    targetModel,
                    {
                        initProgressCallback: (report: { progress: number; text: string }) => {
                            llmStatusStore.set({
                                state: 'loading',
                                progress: report.progress,
                                text: report.text,
                            });
                        },
                    },
                    { context_window_size: 8192 }
                );

                engineState.engine = created as unknown as WebLlmEngine;
                llmStatusStore.set({ state: 'ready', modelId: targetModel });
                logger.info(`[AI Engine] WebLLM loaded: ${targetModel}`);
                return engineState.engine;
            })();

            engineState.initPromise.catch((error) => {
                llmStatusStore.set({ state: 'error', message: String(error) });
                engineState.initPromise = null;
                engineState.engine = null;
            });

            return engineState.initPromise;
        }
);

export const unloadWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function unloadWebLlmEngine(): void {
            if (engineState.worker) {
                engineState.worker.terminate();
                engineState.worker = null;
            }
            engineState.engine = null;
            engineState.initPromise = null;
            logger.info('[AI Engine] WebLLM unloaded from memory');
        }
);

export function isWebLlmLoaded(): boolean {
    return engineState.engine !== null;
}

export function getLlmEngine(): WebLlmEngine | null {
    return engineState.engine;
}

/**
 * Legacy text completion — kept for the chat assistant (non-command use).
 */
export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
    const eng = await initWebLlmEngine();
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const payload: Record<string, unknown> = {
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 2048,
        seed: 0,
    };

    // Log model id + payload keys (never payload contents) so any stray
    // `tools:` attachment on a WebLLM call surfaces as a single structured
    // line instead of an `UnsupportedModelIdError` stack trace. MLC models do
    // not support the native `tools` API; see `supportsToolsApi()` in
    // `#/utils/capabilities`.
    logger.info(
        `[WebLLM] completion model=${engineState.activeModelId} keys=${Object.keys(payload).sort().join(',')}`
    );

    const response = (await eng.chat.completions.create(payload)) as {
        choices: Array<{ message: { content: string } }>;
    };

    const raw = response.choices[0]?.message.content ?? '';
    // Qwen3 prefixes answers with <think>...</think> reasoning blocks.
    // Strip them so callers receive only the final output.
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
