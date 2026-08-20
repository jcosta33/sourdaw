import { describe, it, expect, vi, beforeEach } from 'vitest';

import { engineState } from '../engineLifecycleState';
import { initWebLlmEngine } from '../initWebLlmEngine';
import { unloadWebLlmEngine } from '../unloadWebLlmEngine';

const { admissionGate, artifactAdmissionMock, mockLogger, createWebWorkerEngineMock, terminateWorkerMock } = vi.hoisted(
    () => ({
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
    })
);
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
    }),
}));
vi.mock('../../llmWorker?worker', () => ({
    default: class MockLlmWorker {
        terminate(): void {
            terminateWorkerMock();
        }
    },
}));

function ignoreEngine(_engine: unknown): void {}

describe('WebLLM engineLifecycle injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('should reject init when WebGPU is unavailable', async () => {
        await expect(initWebLlmEngine()).rejects.toThrow(/WebGPU not available/);
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
            { context_window_size: 8192 }
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
});
