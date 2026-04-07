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

let engine: WebLlmEngine | null = null;
let initPromise: Promise<WebLlmEngine> | null = null;
let engineWorker: Worker | null = null;
let activeModelId: string = DEFAULT_WEBLLM_MODEL_ID;

export function getActiveModelId(): string {
    return activeModelId;
}

export const initWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function initWebLlmEngine(modelId?: string): Promise<WebLlmEngine> {
            const targetModel = modelId ?? activeModelId;

            // If already loaded with the same model, return immediately
            if (engine && targetModel === activeModelId) {
                return Promise.resolve(engine);
            }

            // If switching models, unload the current one first
            if (engine && targetModel !== activeModelId) {
                unloadWebLlmEngine();
            }

            if (initPromise && targetModel === activeModelId) {
                return initPromise;
            }

            activeModelId = targetModel;

            // WebGPU is required — absent on Linux (WebKitGTK) and older browsers
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                return Promise.reject(
                    new Error('WebGPU not available — WebLLM requires WebGPU. Use native or cloud backend instead.')
                );
            }

            initPromise = (async () => {
                llmStatusStore.set({ state: 'loading', progress: 0, text: 'Loading AI engine...' });

                // Dynamic import — avoids loading the 6.2MB WebLLM bundle at app startup.
                // The bundle is only fetched when the user actually requests model loading.
                const [{ CreateWebWorkerMLCEngine }, { default: LlmWorker }] = await Promise.all([
                    import('@mlc-ai/web-llm'),
                    import('../llmWorker?worker'),
                ]);

                const worker = new LlmWorker();
                engineWorker = worker;

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

                engine = created as unknown as WebLlmEngine;
                llmStatusStore.set({ state: 'ready', modelId: targetModel });
                logger.info(`[AI Engine] WebLLM loaded: ${targetModel}`);
                return engine;
            })();

            initPromise.catch((error) => {
                llmStatusStore.set({ state: 'error', message: String(error) });
                initPromise = null;
                engine = null;
            });

            return initPromise;
        }
);

export const unloadWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function unloadWebLlmEngine(): void {
            if (engineWorker) {
                engineWorker.terminate();
                engineWorker = null;
            }
            engine = null;
            initPromise = null;
            logger.info('[AI Engine] WebLLM unloaded from memory');
        }
);

export function isWebLlmLoaded(): boolean {
    return engine !== null;
}

export function getLlmEngine(): WebLlmEngine | null {
    return engine;
}

/**
 * Legacy text completion — kept for the chat assistant (non-command use).
 */
export async function generateWebLlmCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    const eng = await initWebLlmEngine();
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = (await eng.chat.completions.create({
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        seed: 0,
    })) as { choices: Array<{ message: { content: string } }> };
    return response.choices[0]?.message.content ?? '';
}
