import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { llmStatusStore } from '../../stores/llmStatusStore';

import { engineState, type WebLlmEngine } from './engineLifecycleState';
import { unloadWebLlmEngine } from './unloadWebLlmEngine';
import { admitWebLlmModelArtifacts } from './webLlmArtifactAdmission';
import { getWebLlmArtifactManifestModel } from './webLlmArtifactManifest';

type InitWebLlmEngineOptions = {
    downloadConsent?: boolean;
    signal?: AbortSignal;
};

export const initWebLlmEngine = inject({ logger, admitWebLlmModelArtifacts })(
    ({ logger, admitWebLlmModelArtifacts }) =>
        function initWebLlmEngine(modelId?: string, options: InitWebLlmEngineOptions = {}): Promise<WebLlmEngine> {
            const targetModel = modelId ?? engineState.activeModelId;
            let targetArtifactSetDigest: string;
            try {
                targetArtifactSetDigest = getWebLlmArtifactManifestModel(targetModel).artifactSetDigest;
            } catch (error) {
                return Promise.reject(error);
            }
            if (options.signal?.aborted) {
                const reason: unknown = options.signal.reason;
                return Promise.reject(
                    reason instanceof Error ? reason : new DOMException('WebLLM initialization aborted', 'AbortError')
                );
            }

            // If already loaded with the same model, return immediately
            if (
                engineState.engine &&
                targetModel === engineState.activeModelId &&
                targetArtifactSetDigest === engineState.activeArtifactSetDigest
            ) {
                return Promise.resolve(engineState.engine);
            }

            // If switching models, unload the current one first
            if (
                engineState.engine &&
                (targetModel !== engineState.activeModelId ||
                    targetArtifactSetDigest !== engineState.activeArtifactSetDigest)
            ) {
                unloadWebLlmEngine();
            }

            if (
                engineState.initPromise &&
                targetModel === engineState.initModelId &&
                !engineState.initSignal?.aborted
            ) {
                return waitForWebLlmAttempt({
                    attemptId: engineState.initAttemptId,
                    promise: engineState.initPromise,
                    signal: options.signal,
                });
            }

            if (engineState.initPromise) {
                engineState.initController?.abort(new DOMException('WebLLM initialization superseded', 'AbortError'));
                if (engineState.worker) {
                    engineState.worker.terminate();
                    engineState.worker = null;
                }
            }

            // WebGPU is required. Chromium ships it, but not unconditionally:
            // it is still absent behind older builds and on Linux GPU stacks
            // Chromium refuses to accelerate, so this probe is live on every
            // target.
            if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
                return Promise.reject(
                    new Error('WebGPU not available — WebLLM requires WebGPU. Use native or cloud backend instead.')
                );
            }

            engineState.activeModelId = targetModel;
            const attemptId = crypto.randomUUID();
            const attemptController = new AbortController();
            const attemptSignal = attemptController.signal;
            engineState.initAttemptId = attemptId;
            engineState.initModelId = targetModel;
            engineState.initController = attemptController;
            engineState.initSignal = attemptSignal;
            engineState.initWaiterCount = 0;
            let attemptWorker: Worker | null = null;

            const attemptPromise = (async () => {
                if (!attemptSignal.aborted) {
                    llmStatusStore.set({ state: 'loading', progress: 0, text: 'Loading AI engine...' });
                }

                let initializedEngine: WebLlmEngine | null = null;
                const admission = await admitWebLlmModelArtifacts(targetModel, {
                    consume: async (verifiedAdmission) => {
                        // Dynamic import — avoids loading the 6.2MB WebLLM bundle at app startup.
                        // The browser-wide admission lock stays held until the worker has consumed the verified set.
                        const [{ CreateWebWorkerMLCEngine }, { default: LlmWorker }] = await Promise.all([
                            import('@mlc-ai/web-llm'),
                            import('../llmWorker?worker'),
                        ]);
                        attemptSignal.throwIfAborted();

                        const worker = new LlmWorker();
                        attemptWorker = worker;
                        engineState.worker = worker;
                        function handleAbort() {
                            worker.terminate();
                            if (engineState.worker === worker) {
                                engineState.worker = null;
                            }
                        }
                        attemptSignal.addEventListener('abort', handleAbort, { once: true });

                        let created: Awaited<ReturnType<typeof CreateWebWorkerMLCEngine>>;
                        try {
                            created = await CreateWebWorkerMLCEngine(
                                worker,
                                targetModel,
                                {
                                    appConfig: verifiedAdmission.appConfig,
                                    initProgressCallback: (report: { progress: number; text: string }) => {
                                        if (attemptSignal.aborted || engineState.initAttemptId !== attemptId) {
                                            return;
                                        }
                                        llmStatusStore.set({
                                            state: 'loading',
                                            progress: report.progress,
                                            text: report.text,
                                        });
                                    },
                                },
                                { context_window_size: 8192 }
                            );
                        } finally {
                            attemptSignal.removeEventListener('abort', handleAbort);
                        }
                        attemptSignal.throwIfAborted();
                        if (engineState.initAttemptId !== attemptId) {
                            worker.terminate();
                            throw new DOMException('WebLLM initialization superseded', 'AbortError');
                        }

                        // eslint-disable-next-line sourdaw/no-type-assertion-escape -- WebWorkerMLCEngine and WebLlmEngine are structurally compatible subsets; cast required due to overloaded chat.completions.create signature
                        initializedEngine = created as unknown as WebLlmEngine;
                    },
                    downloadConsent: options.downloadConsent,
                    onProgress: (report) => {
                        if (attemptSignal.aborted || engineState.initAttemptId !== attemptId) {
                            return;
                        }
                        llmStatusStore.set({
                            state: 'loading',
                            progress: report.progress,
                            text: report.text,
                        });
                    },
                    signal: attemptSignal,
                });
                attemptSignal.throwIfAborted();
                if (!initializedEngine) {
                    throw new Error('WebLLM artifact consumer did not initialize an engine');
                }

                engineState.engine = initializedEngine;
                engineState.activeArtifactSetDigest = admission.artifactSetDigest;
                if (!attemptSignal.aborted) {
                    llmStatusStore.set({ state: 'ready', backend: 'webllm', modelId: targetModel });
                }
                engineState.initPromise = null;
                engineState.initAttemptId = null;
                engineState.initModelId = null;
                engineState.initController = null;
                engineState.initSignal = null;
                engineState.initWaiterCount = 0;
                logger.info(`[AI Engine] WebLLM loaded: ${targetModel}`);
                return engineState.engine;
            })();
            engineState.initPromise = attemptPromise;

            attemptPromise.catch((error) => {
                if (engineState.initAttemptId !== attemptId) {
                    return;
                }
                if (attemptWorker && engineState.worker === attemptWorker) {
                    attemptWorker.terminate();
                    engineState.worker = null;
                }
                if (!attemptSignal.aborted) {
                    llmStatusStore.set({ state: 'error', message: String(error) });
                }
                engineState.initPromise = null;
                engineState.initAttemptId = null;
                engineState.initModelId = null;
                engineState.initController = null;
                engineState.initSignal = null;
                engineState.initWaiterCount = 0;
                engineState.engine = null;
                engineState.activeArtifactSetDigest = null;
            });

            return waitForWebLlmAttempt({
                attemptId,
                promise: attemptPromise,
                signal: options.signal,
            });
        }
);

type WaitForWebLlmAttemptInput = {
    attemptId: string | null;
    promise: Promise<WebLlmEngine>;
    signal?: AbortSignal;
};

function waitForWebLlmAttempt({ attemptId, promise, signal }: WaitForWebLlmAttemptInput): Promise<WebLlmEngine> {
    engineState.initWaiterCount += 1;
    let released = false;

    function releaseWaiter(): void {
        if (released) {
            return;
        }
        released = true;
        if (engineState.initAttemptId !== attemptId) {
            return;
        }
        engineState.initWaiterCount = Math.max(0, engineState.initWaiterCount - 1);
        if (engineState.initWaiterCount === 0 && engineState.initPromise) {
            engineState.initController?.abort(new DOMException('WebLLM initialization abandoned', 'AbortError'));
        }
    }

    if (!signal) {
        return promise.finally(releaseWaiter);
    }

    const abortSignal = signal;
    return new Promise<WebLlmEngine>((resolve, reject) => {
        function onAbort(): void {
            releaseWaiter();
            const reason: unknown = abortSignal.reason;
            reject(reason instanceof Error ? reason : new DOMException('WebLLM initialization aborted', 'AbortError'));
        }

        abortSignal.addEventListener('abort', onAbort, { once: true });
        void promise.then(
            (engine) => {
                abortSignal.removeEventListener('abort', onAbort);
                releaseWaiter();
                return resolve(engine);
            },
            (error: unknown) => {
                abortSignal.removeEventListener('abort', onAbort);
                releaseWaiter();
                return reject(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
}
