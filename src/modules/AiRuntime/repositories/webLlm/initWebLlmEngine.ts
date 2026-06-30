import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { llmStatusStore } from '../../stores/llmStatusStore';

import { engineState, type WebLlmEngine } from './engineLifecycleState';
import { unloadWebLlmEngine } from './unloadWebLlmEngine';

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

                // eslint-disable-next-line sourdaw/no-type-assertion-escape -- WebWorkerMLCEngine and WebLlmEngine are structurally compatible subsets; cast required due to overloaded chat.completions.create signature
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
