import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { LocalModelRefusalError } from '../../../errors/LocalModelRefusalError';
import { DEFAULT_WEBLLM_MODEL_ID } from '../../../models/ModelInfo';
import { answeringStatus } from '../../../stores/answeringStatus';
import { llmStatusStore } from '../../../stores/llmStatusStore';
import { engineState } from '../engineLifecycleState';
import { initWebLlmEngine } from '../initWebLlmEngine';
import { retireWebLlmEngine } from '../retireWebLlmEngine';
import { unloadWebLlmEngine } from '../unloadWebLlmEngine';
import { webLlmRequestCoordinator } from '../webLlmRequestCoordinator';

const {
    admissionGate,
    artifactAdmissionMock,
    mockLogger,
    createWebWorkerEngineMock,
    terminateWorkerMock,
    MockLlmWorker,
    workerInstances,
    workerSpawns,
    BUDGET_CONTEXT_WINDOW_SIZE,
    MANIFEST_CONTEXT_WINDOW_SIZE,
} = vi.hoisted(() => {
    const workerInstances: EventTarget[] = [];
    const workerSpawns: { url: string | URL; options: WorkerOptions | undefined }[] = [];
    return {
        // Distinct from each other and from every shipped window, so the engine can only load the
        // window the planning budget reads, never the digested manifest's.
        BUDGET_CONTEXT_WINDOW_SIZE: 12_345,
        MANIFEST_CONTEXT_WINDOW_SIZE: 4_321,
        admissionGate: { webLlm: true },
        artifactAdmissionMock: vi.fn(),
        mockLogger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        createWebWorkerEngineMock: vi.fn(),
        terminateWorkerMock: vi.fn(),
        workerInstances,
        workerSpawns,
        MockLlmWorker: class MockLlmWorker extends EventTarget {
            constructor(url: string | URL, options?: WorkerOptions) {
                super();
                workerSpawns.push({ url, options });
                workerInstances.push(this);
            }

            terminate(): void {
                terminateWorkerMock();
            }
        },
    };
});
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: admissionGate,
}));
vi.mock('@mlc-ai/web-llm', () => ({
    CreateWebWorkerMLCEngine: createWebWorkerEngineMock,
}));
vi.mock('../webLlmArtifactAdmission', () => ({
    admitWebLlmModelArtifacts: artifactAdmissionMock,
}));
vi.mock('../webLlmArtifactManifest', () => ({
    getWebLlmArtifactManifestModel: (modelId: string) => ({
        artifactSetDigest: `digest:${modelId}`,
        engine: { contextWindowSize: MANIFEST_CONTEXT_WINDOW_SIZE },
    }),
}));
vi.mock('../getWebLlmContextWindowSize', () => ({
    getWebLlmContextWindowSize: () => BUDGET_CONTEXT_WINDOW_SIZE,
}));
function ignoreEngine(_engine: unknown): void {}

describe('WebLLM engineLifecycle injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        answeringStatus.clear();
        vi.stubGlobal('Worker', MockLlmWorker);
        workerInstances.length = 0;
        workerSpawns.length = 0;
        admissionGate.webLlm = true;
        artifactAdmissionMock.mockReset();
        createWebWorkerEngineMock.mockReset();
        engineState.engine = null;
        engineState.initPromise = null;
        engineState.initAttemptId = null;
        engineState.initModelId = null;
        engineState.initController = null;
        engineState.initSignal = null;
        engineState.initWaiterCount = 0;
        engineState.worker = null;
        engineState.activeArtifactSetDigest = null;
        engineState.activeModelId = DEFAULT_WEBLLM_MODEL_ID;
        artifactAdmissionMock.mockImplementation(
            async (modelId: string, options?: { consume?: (admission: unknown) => Promise<void> }) => {
                const admission = {
                    appConfig: {
                        cacheBackend: 'cache',
                        model_list: [
                            {
                                model: `https://models.invalid/${modelId}/`,
                                model_id: modelId,
                                model_lib: `https://models.invalid/${modelId}.wasm`,
                            },
                        ],
                    },
                    artifactSetDigest: `digest:${modelId}`,
                };
                await options?.consume?.(admission);
                return admission;
            }
        );
        createWebWorkerEngineMock.mockResolvedValue({
            interruptGenerate: vi.fn(),
            chat: { completions: { create: vi.fn() } },
        });
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should reject init when WebGPU is unavailable', async () => {
        await expect(initWebLlmEngine()).rejects.toThrow(
            'WebGPU not available — WebLLM requires WebGPU. Hosted providers are available only in desktop builds.'
        );
        expect(engineState.initAttemptId).toBeNull();
        expect(engineState.initController).toBeNull();
        expect(engineState.initPromise).toBeNull();
    });

    it('should reject init when browser model artifacts are withheld', async () => {
        admissionGate.webLlm = false;
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });

        await expect(initWebLlmEngine()).rejects.toThrow(/not admitted in this release/);
        expect(artifactAdmissionMock).not.toHaveBeenCalled();
    });

    it('should unload engine and log', () => {
        unloadWebLlmEngine();
        expect(mockLogger.info).toHaveBeenCalledWith('[AI Engine] WebLLM unloaded from memory');
    });

    it('starts the llmWorker entry from the AiRuntime workers folder as a module worker', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });

        await initWebLlmEngine('test-model');

        expect(workerSpawns).toHaveLength(1);
        const [spawn] = workerSpawns;
        expect(new URL(String(spawn?.url)).pathname.endsWith('AiRuntime/workers/llmWorker.ts')).toBe(true);
        expect(spawn?.options?.type).toBe('module');
    });

    it('does not let a stale worker retirement clear its replacement engine', () => {
        const staleEngine = { interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } };
        const replacementEngine = { interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } };
        engineState.engine = replacementEngine;

        retireWebLlmEngine(staleEngine, new Error('stale worker failure'));

        expect(engineState.engine).toBe(replacementEngine);
    });

    it('terminates the worker and discards the engine when initialization is aborted', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        let resolveEngine: (engine: unknown) => void = ignoreEngine;
        createWebWorkerEngineMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveEngine = resolve;
                })
        );
        const controller = new AbortController();
        const pending = initWebLlmEngine('test-model', { signal: controller.signal });
        await vi.waitFor(() => expect(createWebWorkerEngineMock).toHaveBeenCalledTimes(1));

        const cancellation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        resolveEngine({ chat: { completions: { create: vi.fn() } } });

        await cancellation;
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
        expect(engineState.engine).toBeNull();
        expect(engineState.worker).toBeNull();
    });

    it('rejects initialization when the attempt worker reports messageerror before provider creation settles', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        createWebWorkerEngineMock.mockImplementation(() => new Promise(() => undefined));
        const pending = initWebLlmEngine('test-model');
        await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

        workerInstances[0]?.dispatchEvent(new Event('messageerror'));

        await expect(pending).rejects.toThrow('WebLLM worker failed');
        await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
        expect(engineState.engine).toBeNull();
        expect(terminateWorkerMock).toHaveBeenCalledOnce();
    });

    it('retires the ready engine and rejects its waiting requests when the worker fails after initialization', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        const engine = await initWebLlmEngine('test-model');
        const worker = workerInstances[0];
        if (!worker) {
            throw new Error('Expected the initialized engine to own a worker instance.');
        }
        const waiting = webLlmRequestCoordinator.run(engine, { execute: () => new Promise(() => undefined) });

        worker.dispatchEvent(new Event('messageerror'));

        expect(engineState.engine).toBeNull();
        expect(engineState.worker).toBeNull();
        await expect(waiting).rejects.toThrow('WebLLM worker failed');
    });

    it('waits for complete artifact admission before creating a worker and passes the immutable app config', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        let resolveAdmission: (value: {
            appConfig: {
                cacheBackend: 'cache';
                model_list: Array<{ model: string; model_id: string; model_lib: string }>;
            };
            artifactSetDigest: string;
        }) => void = ignoreEngine;
        artifactAdmissionMock.mockImplementation(
            async (_modelId: string, options?: { consume?: (admission: unknown) => Promise<void> }) => {
                const admission = await new Promise<{
                    appConfig: {
                        cacheBackend: 'cache';
                        model_list: Array<{ model: string; model_id: string; model_lib: string }>;
                    };
                    artifactSetDigest: string;
                }>((resolve) => {
                    resolveAdmission = resolve;
                });
                await options?.consume?.(admission);
                return admission;
            }
        );
        const pending = initWebLlmEngine('test-model', { downloadConsent: true });
        await vi.waitFor(() => expect(artifactAdmissionMock).toHaveBeenCalledTimes(1));
        expect(createWebWorkerEngineMock).not.toHaveBeenCalled();
        const appConfig = {
            cacheBackend: 'cache' as const,
            model_list: [
                {
                    model: 'https://models.invalid/revision/',
                    model_id: 'test-model',
                    model_lib: 'https://models.invalid/revision/model.wasm',
                },
            ],
        };
        resolveAdmission({ appConfig, artifactSetDigest: 'digest:test-model' });

        await pending;

        expect(createWebWorkerEngineMock).toHaveBeenCalledWith(
            expect.anything(),
            'test-model',
            expect.objectContaining({ appConfig }),
            { context_window_size: BUDGET_CONTEXT_WINDOW_SIZE }
        );
        expect(engineState.activeArtifactSetDigest).toBe('digest:test-model');
    });

    it('terminates the attempt-owned worker when initialization fails', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        createWebWorkerEngineMock.mockRejectedValue(new Error('engine failed'));

        await expect(initWebLlmEngine('test-model')).rejects.toThrow('engine failed');

        await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        expect(engineState.engine).toBeNull();
        expect(engineState.worker).toBeNull();
    });

    it('starts a fresh same-model attempt after the prior caller aborts', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        const engineResolvers: Array<(engine: unknown) => void> = [];
        createWebWorkerEngineMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    engineResolvers.push(resolve);
                })
        );
        const controller = new AbortController();
        const cancelled = initWebLlmEngine('test-model', { signal: controller.signal });
        await vi.waitFor(() => expect(engineResolvers).toHaveLength(1));

        const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        const replacement = initWebLlmEngine('test-model');
        await vi.waitFor(() => expect(engineResolvers).toHaveLength(2));
        engineResolvers[1]?.({ interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } });
        const replacementEngine = await replacement;
        engineResolvers[0]?.({ interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } });

        await cancellation;
        expect(createWebWorkerEngineMock).toHaveBeenCalledTimes(2);
        expect(engineState.engine).toBe(replacementEngine);
    });

    it('does not let a superseded attempt clear a different-model replacement', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        const engineResolvers: Array<(engine: unknown) => void> = [];
        createWebWorkerEngineMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    engineResolvers.push(resolve);
                })
        );
        const superseded = initWebLlmEngine('model-a');
        await vi.waitFor(() => expect(engineResolvers).toHaveLength(1));

        const supersededRejection = expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
        const replacement = initWebLlmEngine('model-b');
        await vi.waitFor(() => expect(engineResolvers).toHaveLength(2));
        engineResolvers[1]?.({ interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } });
        const replacementEngine = await replacement;
        engineResolvers[0]?.({ interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } });

        await supersededRejection;
        expect(engineState.engine).toBe(replacementEngine);
        expect(engineState.activeModelId).toBe('model-b');
    });

    it('keeps a coalesced same-model attempt alive for callers that did not abort', async () => {
        Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
        let resolveEngine: (engine: unknown) => void = ignoreEngine;
        createWebWorkerEngineMock.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveEngine = resolve;
                })
        );
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = initWebLlmEngine('shared-model', { signal: firstController.signal });
        const second = initWebLlmEngine('shared-model', { signal: secondController.signal });
        await vi.waitFor(() => expect(createWebWorkerEngineMock).toHaveBeenCalledTimes(1));

        const firstCancellation = expect(first).rejects.toMatchObject({ name: 'AbortError' });
        firstController.abort();
        await firstCancellation;
        resolveEngine({ interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } });

        const secondEngine = await second;
        expect(secondEngine).toBe(engineState.engine);
        expect(createWebWorkerEngineMock).toHaveBeenCalledTimes(1);
    });

    describe('a load that cannot proceed leaves the loaded model in place', () => {
        const LOADED_MODEL = 'model-x';

        async function loadModelX() {
            const engine = await initWebLlmEngine(LOADED_MODEL);
            expect(workerInstances).toHaveLength(1);
            terminateWorkerMock.mockClear();
            return engine;
        }

        it('keeps the engine, its worker and its model id when the storage check refuses another model', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const loaded = await loadModelX();
            const worker = engineState.worker;
            artifactAdmissionMock.mockRejectedValueOnce(
                new LocalModelRefusalError({
                    reason: 'insufficient-storage',
                    modelId: 'model-y',
                    requiredBytes: 2_000_000_000,
                    availableBytes: 1_000,
                })
            );

            await expect(initWebLlmEngine('model-y', { downloadConsent: true })).rejects.toMatchObject({
                name: 'LocalModelRefusalError',
            });

            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(engineState.engine).toBe(loaded);
            expect(engineState.worker).toBe(worker);
            expect(engineState.activeModelId).toBe(LOADED_MODEL);
            expect(engineState.activeArtifactSetDigest).toBe(`digest:${LOADED_MODEL}`);
            expect(terminateWorkerMock).not.toHaveBeenCalled();
        });

        it('keeps the engine, its worker and its model id when the adapter lacks shader-f16 for another model', async () => {
            Object.defineProperty(globalThis, 'navigator', {
                value: { gpu: { requestAdapter: async () => ({ features: new Set<string>() }) } },
                configurable: true,
                writable: true,
            });
            const loaded = await loadModelX();
            const worker = engineState.worker;

            await expect(initWebLlmEngine('model-y-q4f16_1-MLC', { downloadConsent: true })).rejects.toMatchObject({
                refusal: { reason: 'shader-f16-unavailable' },
            });

            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(engineState.engine).toBe(loaded);
            expect(engineState.worker).toBe(worker);
            expect(engineState.activeModelId).toBe(LOADED_MODEL);
            expect(terminateWorkerMock).not.toHaveBeenCalled();
        });

        it('leaves no engine but still names the last loaded model when creating the next engine fails', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            await loadModelX();
            createWebWorkerEngineMock.mockRejectedValueOnce('DeviceLostError: gone');

            await expect(initWebLlmEngine('model-y')).rejects.toMatchObject({ name: 'LocalModelRefusalError' });

            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(engineState.engine).toBeNull();
            expect(engineState.worker).toBeNull();
            expect(engineState.activeModelId).toBe(LOADED_MODEL);

            await initWebLlmEngine(undefined);

            expect(createWebWorkerEngineMock).toHaveBeenLastCalledWith(
                expect.anything(),
                LOADED_MODEL,
                expect.anything(),
                expect.anything()
            );
        });

        it('republishes ready for the kept model on the next default load after a refusal', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const loaded = await loadModelX();
            artifactAdmissionMock.mockRejectedValueOnce(
                new LocalModelRefusalError({
                    reason: 'insufficient-storage',
                    modelId: 'model-y',
                    requiredBytes: 2_000_000_000,
                    availableBytes: 1_000,
                })
            );
            await expect(initWebLlmEngine('model-y', { downloadConsent: true })).rejects.toMatchObject({
                name: 'LocalModelRefusalError',
                refusal: { reason: 'insufficient-storage', modelId: 'model-y' },
            });
            await vi.waitFor(() => expect(llmStatusStore.value?.state).toBe('error'));

            await expect(initWebLlmEngine(undefined)).resolves.toBe(loaded);

            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: LOADED_MODEL });
        });

        it('leaves a status another turn owns alone when the loaded model is requested again', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            await loadModelX();
            const generating = { state: 'generating', backend: 'webllm', modelId: LOADED_MODEL } as const;
            llmStatusStore.set(generating);

            await initWebLlmEngine(undefined);

            expect(llmStatusStore.value).toEqual(generating);
        });

        it('shows a refused switch only once the turn answering with the loaded model settles', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            await loadModelX();
            const generating = { state: 'generating', backend: 'webllm', modelId: LOADED_MODEL } as const;
            const turn = answeringStatus.openTurn();
            answeringStatus.publish(turn, generating);
            artifactAdmissionMock.mockRejectedValueOnce(
                new LocalModelRefusalError({
                    reason: 'insufficient-storage',
                    modelId: 'model-y',
                    requiredBytes: 2_000_000_000,
                    availableBytes: 1_000,
                })
            );

            await expect(initWebLlmEngine('model-y', { downloadConsent: true })).rejects.toMatchObject({
                refusal: { reason: 'insufficient-storage' },
            });

            expect(llmStatusStore.value).toEqual(generating);
            answeringStatus.settle(turn, answeringStatus.readSettled());
            expect(llmStatusStore.value).toMatchObject({
                state: 'error',
                refusal: { reason: 'insufficient-storage', modelId: 'model-y' },
            });
        });

        it('republishes ready for the kept model and aborts another model that is still loading', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const loaded = await loadModelX();
            let releaseAdmission: () => void = () => undefined;
            artifactAdmissionMock.mockImplementationOnce(
                async (_modelId: string, options?: { consume?: (admission: unknown) => Promise<void> }) => {
                    await new Promise<void>((resolve) => {
                        releaseAdmission = resolve;
                    });
                    await options?.consume?.({ appConfig: { cacheBackend: 'cache', model_list: [] } });
                }
            );
            const superseded = initWebLlmEngine('model-y');
            const supersededRejection = expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
            await vi.waitFor(() => expect(llmStatusStore.value?.state).toBe('loading'));
            const supersededSignal = engineState.initSignal;

            await expect(initWebLlmEngine(LOADED_MODEL)).resolves.toBe(loaded);

            expect(supersededSignal?.aborted).toBe(true);
            expect(llmStatusStore.value).toEqual({ state: 'ready', backend: 'webllm', modelId: LOADED_MODEL });

            releaseAdmission();
            await supersededRejection;
            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(engineState.engine).toBe(loaded);
            expect(engineState.activeModelId).toBe(LOADED_MODEL);
        });

        it('keeps the engine and model id when the attempt is aborted before the engine library loads', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const loaded = await loadModelX();
            let releaseAdmission: () => void = () => undefined;
            artifactAdmissionMock.mockImplementationOnce(
                async (_modelId: string, options?: { consume?: (admission: unknown) => Promise<void> }) => {
                    await new Promise<void>((resolve) => {
                        releaseAdmission = resolve;
                    });
                    await options?.consume?.({ appConfig: { cacheBackend: 'cache', model_list: [] } });
                }
            );
            const controller = new AbortController();
            const pending = initWebLlmEngine('model-y', { signal: controller.signal });
            const cancellation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            await vi.waitFor(() => expect(artifactAdmissionMock).toHaveBeenCalledTimes(2));

            controller.abort();
            releaseAdmission();
            await cancellation;

            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(engineState.engine).toBe(loaded);
            expect(engineState.activeModelId).toBe(LOADED_MODEL);
            expect(terminateWorkerMock).not.toHaveBeenCalled();
        });

        function holdAdmission() {
            const held = { release: () => undefined as void };
            artifactAdmissionMock.mockImplementationOnce(
                async (modelId: string, options?: { consume?: (admission: unknown) => Promise<void> }) => {
                    await new Promise<void>((resolve) => {
                        held.release = resolve;
                    });
                    const admission = {
                        appConfig: { cacheBackend: 'cache', model_list: [] },
                        artifactSetDigest: `digest:${modelId}`,
                    };
                    await options?.consume?.(admission);
                    return admission;
                }
            );
            return held;
        }

        it('answers an unnamed request with the loaded model while another model loads', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const loaded = await loadModelX();
            const held = holdAdmission();
            const switching = initWebLlmEngine('model-y');
            await vi.waitFor(() => expect(llmStatusStore.value?.state).toBe('loading'));
            const switchSignal = engineState.initSignal;

            await expect(initWebLlmEngine(undefined)).resolves.toBe(loaded);

            expect(switchSignal?.aborted).toBe(false);
            expect(engineState.activeModelId).toBe(LOADED_MODEL);
            expect(llmStatusStore.value?.state).toBe('loading');
            held.release();
            const switched = await switching;
            expect(engineState.engine).toBe(switched);
            expect(engineState.activeModelId).toBe('model-y');
        });

        it('joins the load in flight when an unnamed request finds nothing installed', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            const held = holdAdmission();
            const first = initWebLlmEngine('model-y');
            await vi.waitFor(() => expect(llmStatusStore.value?.state).toBe('loading'));
            const switchSignal = engineState.initSignal;

            const joined = initWebLlmEngine(undefined);

            expect(switchSignal?.aborted).toBe(false);
            held.release();
            const [firstEngine, joinedEngine] = await Promise.all([first, joined]);
            expect(joinedEngine).toBe(firstEngine);
            expect(createWebWorkerEngineMock).toHaveBeenCalledTimes(1);
            expect(engineState.activeModelId).toBe('model-y');
        });

        it('leaves the kept engine worker running when a third model supersedes a load in flight', async () => {
            Object.defineProperty(globalThis, 'navigator', { value: { gpu: {} }, configurable: true, writable: true });
            await loadModelX();
            const keptWorker = engineState.worker;
            const heldY = holdAdmission();
            const superseded = initWebLlmEngine('model-y');
            const supersededRejection = expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
            await vi.waitFor(() => expect(llmStatusStore.value?.state).toBe('loading'));
            holdAdmission();
            const controller = new AbortController();

            const replacement = initWebLlmEngine('model-z', { signal: controller.signal });
            const replacementRejection = expect(replacement).rejects.toMatchObject({ name: 'AbortError' });

            await vi.waitFor(() => expect(artifactAdmissionMock).toHaveBeenCalledTimes(3));
            expect(terminateWorkerMock).not.toHaveBeenCalled();
            expect(engineState.worker).toBe(keptWorker);
            expect(engineState.engine).not.toBeNull();

            controller.abort();
            heldY.release();
            await Promise.all([supersededRejection, replacementRejection]);
        });
    });
});
