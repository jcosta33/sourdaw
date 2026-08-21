import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';
import {
    createTfjsInferenceRequestHandler,
    type TfjsWorkerModel,
    type TfjsWorkerRuntime,
    type TfjsWorkerTensor,
} from '../tfjsInferenceWorkerRuntime';

type Deferred<TValue> = {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
    reject: (reason: unknown) => void;
};

type FakeTensor = TfjsWorkerTensor & {
    values: Float32Array;
    data: () => Promise<Float32Array>;
    dispose: Mock<() => void>;
};

type FakeModel = {
    predict: Mock<TfjsWorkerModel['predict']>;
    dispose: Mock<() => void>;
};

type Runtime = ReturnType<typeof createTfjsInferenceRequestHandler>;

const MODEL_JSON = new TextEncoder().encode(
    JSON.stringify({ modelTopology: {}, weightsManifest: [{ weights: [] }], format: 'graph-model' })
).buffer;
const SETTINGS = new TextEncoder().encode(JSON.stringify({ modelMaxFrameLength: 1_250 })).buffer;
const WEIGHTS = Uint8Array.from([1, 2, 3]).buffer;

function deferred<TValue>(): Deferred<TValue> {
    let resolveDeferred: (value: TValue) => void = () => undefined;
    let rejectDeferred: (reason: unknown) => void = () => undefined;
    const promise = new Promise<TValue>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });
    return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

function fakeTensor(values: Float32Array, output?: Float32Array | Promise<Float32Array>): FakeTensor {
    return {
        values,
        data: vi.fn(() => Promise.resolve(output ?? values)),
        dispose: vi.fn(),
    };
}

function artifactPort(
    bytes: ArrayBuffer,
    mode: 'data' | 'error' | 'malformed' | 'messageerror' | 'pending' = 'data'
): MessagePort {
    const port = {
        close: vi.fn(),
        onmessage: null as ((event: MessageEvent) => void) | null,
        onmessageerror: null as ((event: MessageEvent) => void) | null,
        start: vi.fn(() => {
            queueMicrotask(() => {
                if (mode === 'data') {
                    port.onmessage?.(new MessageEvent('message', { data: { type: 'model-data', modelData: bytes } }));
                } else if (mode === 'error') {
                    port.onmessage?.(
                        new MessageEvent('message', { data: { type: 'model-error', message: 'model read failed' } })
                    );
                } else if (mode === 'malformed') {
                    port.onmessage?.(new MessageEvent('message'));
                } else if (mode === 'messageerror') {
                    port.onmessageerror?.(new MessageEvent('messageerror'));
                }
            });
        }),
    };
    return port as unknown as MessagePort;
}

function artifacts(overrides: Partial<Record<DdspStoredArtifact['path'], MessagePort>> = {}): DdspStoredArtifact[] {
    return [
        {
            modelId: 'ddsp-violin/v1/model.json',
            path: 'model.json',
            sizeBytes: MODEL_JSON.byteLength,
            sha256: 'a'.repeat(64),
            modelDataPort: overrides['model.json'] ?? artifactPort(MODEL_JSON),
        },
        {
            modelId: 'ddsp-violin/v1/group1-shard1of1.bin',
            path: 'group1-shard1of1.bin',
            sizeBytes: WEIGHTS.byteLength,
            sha256: 'b'.repeat(64),
            modelDataPort: overrides['group1-shard1of1.bin'] ?? artifactPort(WEIGHTS),
        },
        {
            modelId: 'ddsp-violin/v1/settings.json',
            path: 'settings.json',
            sizeBytes: SETTINGS.byteLength,
            sha256: 'c'.repeat(64),
            modelDataPort: overrides['settings.json'] ?? artifactPort(SETTINGS),
        },
    ];
}

function createSessionRequest(requestId: string, requestArtifacts = artifacts()): WorkerRequest {
    return {
        type: 'create-session-from-model-storage',
        requestId,
        modelId: 'ddsp-violin:v1',
        artifacts: requestArtifacts,
    };
}

function inferenceRequest(requestId: string, frameCount: number): WorkerRequest {
    return {
        type: 'run-ddsp-inference',
        requestId,
        modelId: 'ddsp-violin:v1',
        pitchHz: Float32Array.from({ length: frameCount }, (_, index) => 100 + index),
        loudnessDb: Float32Array.from({ length: frameCount }, (_, index) => -60 + index / 100),
        frameRate: 250,
    };
}

function createHarness(
    input: {
        backend?: string;
        loadGraphModel?: Mock<TfjsWorkerRuntime['loadGraphModel']>;
        predict?: Mock<TfjsWorkerModel['predict']>;
        idleMs?: number;
    } = {}
): {
    backend: { value: string };
    initializeTfjs: ReturnType<typeof vi.fn>;
    loadGraphModel: Mock<TfjsWorkerRuntime['loadGraphModel']>;
    model: FakeModel;
    responses: WorkerResponse[];
    runtime: Runtime;
    tensor1d: Mock<TfjsWorkerRuntime['tensor1d']>;
} {
    const backend = { value: input.backend ?? 'webgpu' };
    const predict = input.predict ?? vi.fn(() => fakeTensor(new Float32Array(80_000).fill(1)));
    const model: FakeModel = { predict, dispose: vi.fn() };
    const loadGraphModel =
        input.loadGraphModel ??
        vi.fn(async (handler: { load: () => Promise<unknown> }) => {
            await handler.load();
            return model;
        });
    const tensor1d = vi.fn((values: Float32Array) => fakeTensor(Float32Array.from(values)));
    const tf = { getBackend: () => backend.value, loadGraphModel, tensor1d };
    const initializeTfjs = vi.fn(() => Promise.resolve(tf));
    const responses: WorkerResponse[] = [];
    const runtime = createTfjsInferenceRequestHandler({
        idleMs: input.idleMs ?? 1_000,
        initializeTfjs,
        postResponse: (response) => responses.push(response),
    });
    runtimes.push(runtime);
    return { backend, initializeTfjs, loadGraphModel, model, responses, runtime, tensor1d };
}

const runtimes: Runtime[] = [];

afterEach(() => {
    for (const runtime of runtimes.splice(0)) {
        runtime.dispose();
    }
    vi.useRealTimers();
});

describe('tfjsInferenceWorkerRuntime', () => {
    it('coalesces TF.js initialization and concurrent identical model loads', async () => {
        const modelGate = deferred<FakeModel>();
        const harness = createHarness({
            loadGraphModel: vi.fn(async (handler: { load: () => Promise<unknown> }) => {
                await handler.load();
                return modelGate.promise;
            }),
        });
        const firstArtifacts = artifacts();
        const secondArtifacts = artifacts();

        const first = harness.runtime.handleRequest(createSessionRequest('load-a', firstArtifacts));
        const second = harness.runtime.handleRequest(createSessionRequest('load-b', secondArtifacts));
        await vi.waitFor(() => expect(harness.loadGraphModel).toHaveBeenCalledOnce());
        modelGate.resolve(harness.model);
        await Promise.all([first, second]);

        expect(harness.initializeTfjs).toHaveBeenCalledOnce();
        expect(harness.loadGraphModel).toHaveBeenCalledOnce();
        expect(harness.responses).toEqual([
            { type: 'session-created', requestId: 'load-a', modelId: 'ddsp-violin:v1', backend: 'webgpu' },
            { type: 'session-created', requestId: 'load-b', modelId: 'ddsp-violin:v1', backend: 'webgpu' },
        ]);
        for (const artifact of [...firstArtifacts, ...secondArtifacts]) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('disposes a model exactly once when cancellation makes its completed load a loser', async () => {
        const modelGate = deferred<FakeModel>();
        const harness = createHarness({
            loadGraphModel: vi.fn(async (handler: { load: () => Promise<unknown> }) => {
                await handler.load();
                return modelGate.promise;
            }),
        });
        const load = harness.runtime.handleRequest(createSessionRequest('cancelled-load'));
        await vi.waitFor(() => expect(harness.loadGraphModel).toHaveBeenCalledOnce());

        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'cancelled-load' });
        modelGate.resolve(harness.model);
        await load;

        expect(harness.model.dispose).toHaveBeenCalledOnce();
        expect(harness.responses).toEqual([]);
        harness.runtime.dispose();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('disposes a model exactly once when post-load backend validation fails', async () => {
        const harness = createHarness();
        harness.loadGraphModel.mockImplementationOnce(async (handler: { load: () => Promise<unknown> }) => {
            await handler.load();
            harness.backend.value = 'wasm';
            return harness.model;
        });

        await harness.runtime.handleRequest(createSessionRequest('failed-loaded-model'));

        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'failed-loaded-model',
            error: expect.stringContaining('wasm'),
        });
        expect(harness.model.dispose).toHaveBeenCalledOnce();
        harness.runtime.dispose();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('disposes loaded sessions exactly once on release and on idle eviction', async () => {
        vi.useFakeTimers();
        const released = createHarness();
        await released.runtime.handleRequest(createSessionRequest('release-load'));
        await released.runtime.handleRequest({ type: 'release-session', modelId: 'ddsp-violin:v1' });
        expect(released.model.dispose).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(released.model.dispose).toHaveBeenCalledOnce();

        const idle = createHarness();
        await idle.runtime.handleRequest(createSessionRequest('idle-load'));
        await vi.advanceTimersByTimeAsync(1_000);
        expect(idle.model.dispose).toHaveBeenCalledOnce();
    });

    it('schedules idle disposal after inference failure', async () => {
        vi.useFakeTimers();
        const harness = createHarness({
            predict: vi.fn(() => {
                throw new Error('predict failed');
            }),
        });
        await harness.runtime.handleRequest(createSessionRequest('load'));
        await harness.runtime.handleRequest(inferenceRequest('infer', 125));

        expect(harness.responses.at(-1)).toEqual({ type: 'error', requestId: 'infer', error: 'predict failed' });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('waits for every overlapping request before disposing an idle session', async () => {
        vi.useFakeTimers();
        const slowData = deferred<Float32Array>();
        const fastAudio = new Float32Array(80_000).fill(1);
        const slowAudio = new Float32Array(80_000).fill(2);
        const harness = createHarness({
            idleMs: 5,
            predict: vi
                .fn()
                .mockReturnValueOnce(fakeTensor(fastAudio, fastAudio))
                .mockReturnValueOnce(fakeTensor(slowAudio, slowData.promise)),
        });
        await harness.runtime.handleRequest(createSessionRequest('load'));
        await vi.advanceTimersByTimeAsync(4);

        const fast = harness.runtime.handleRequest(inferenceRequest('fast', 125));
        const slow = harness.runtime.handleRequest(inferenceRequest('slow', 125));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledTimes(2));
        await fast;
        await vi.advanceTimersByTimeAsync(5);

        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(harness.responses).toContainEqual(expect.objectContaining({ type: 'ddsp-result', requestId: 'fast' }));

        slowData.resolve(slowAudio);
        await slow;
        await vi.advanceTimersByTimeAsync(5);

        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it.each([
        {
            name: 'incomplete manifest',
            requestArtifacts: () => artifacts().slice(0, 2),
            expectedError: 'manifest is incomplete',
        },
        {
            name: 'model read error',
            requestArtifacts: () => artifacts({ 'model.json': artifactPort(MODEL_JSON, 'error') }),
            expectedError: 'model read failed',
        },
        {
            name: 'port messageerror',
            requestArtifacts: () => artifacts({ 'model.json': artifactPort(MODEL_JSON, 'messageerror') }),
            expectedError: 'unreadable',
        },
        {
            name: 'malformed port response',
            requestArtifacts: () => artifacts({ 'model.json': artifactPort(MODEL_JSON, 'malformed') }),
            expectedError: 'model.json',
        },
    ])('closes every transferred port after $name', async ({ requestArtifacts, expectedError }) => {
        const harness = createHarness();
        const requestPorts = requestArtifacts();

        await harness.runtime.handleRequest(createSessionRequest('bad-load', requestPorts));

        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'bad-load',
            error: expect.stringContaining(expectedError),
        });
        for (const artifact of requestPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('closes every unread port when the session already exists', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(createSessionRequest('first'));
        const unusedArtifacts = artifacts();

        await harness.runtime.handleRequest(createSessionRequest('second', unusedArtifacts));

        expect(harness.loadGraphModel).toHaveBeenCalledOnce();
        for (const artifact of unusedArtifacts) {
            expect(artifact.modelDataPort.start).not.toHaveBeenCalled();
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('closes every transferred port when GraphModel loading fails', async () => {
        const harness = createHarness({
            loadGraphModel: vi.fn(async (handler: { load: () => Promise<unknown> }) => {
                await handler.load();
                throw new Error('graph model rejected');
            }),
        });
        const failedArtifacts = artifacts();

        await harness.runtime.handleRequest(createSessionRequest('graph-load-error', failedArtifacts));

        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'graph-load-error',
            error: 'graph model rejected',
        });
        for (const artifact of failedArtifacts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('closes pending load ports when the request is cancelled or the worker is disposed', async () => {
        const harness = createHarness();
        const cancelledPorts = artifacts({ 'model.json': artifactPort(MODEL_JSON, 'pending') });
        const cancelled = harness.runtime.handleRequest(createSessionRequest('cancel', cancelledPorts));
        await vi.waitFor(() => expect(cancelledPorts[0]?.modelDataPort.start).toHaveBeenCalledOnce());
        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'cancel' });
        await cancelled;
        for (const artifact of cancelledPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }

        const teardown = createHarness();
        const teardownPorts = artifacts({ 'model.json': artifactPort(MODEL_JSON, 'pending') });
        const pending = teardown.runtime.handleRequest(createSessionRequest('teardown', teardownPorts));
        await vi.waitFor(() => expect(teardownPorts[0]?.modelDataPort.start).toHaveBeenCalledOnce());
        teardown.runtime.dispose();
        await pending;
        for (const artifact of teardownPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('closes every transferred port after a successful model load', async () => {
        const harness = createHarness();
        const loadedArtifacts = artifacts();

        await harness.runtime.handleRequest(createSessionRequest('success', loadedArtifacts));

        for (const artifact of loadedArtifacts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('crops a short render to its exact requested native-sample duration', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(createSessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('short', 125));

        const response = harness.responses.at(-1);
        expect(response).toMatchObject({
            type: 'ddsp-result',
            requestId: 'short',
            nativeSampleRate: 16_000,
            backend: 'webgpu',
        });
        if (response?.type === 'ddsp-result') {
            expect(response.audio).toHaveLength(8_000);
        }
        expect(harness.model.predict).toHaveBeenCalledOnce();
    });

    it('overlaps long inputs in order with the Magenta one-second linear crossfade and exact final length', async () => {
        const firstChunk = new Float32Array(80_000).fill(1);
        const secondChunk = new Float32Array(80_000).fill(3);
        const harness = createHarness({
            predict: vi
                .fn()
                .mockReturnValueOnce(fakeTensor(firstChunk, firstChunk))
                .mockReturnValueOnce(fakeTensor(secondChunk, secondChunk)),
        });
        await harness.runtime.handleRequest(createSessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('long', 1_500));

        expect(harness.model.predict).toHaveBeenCalledTimes(2);
        const firstCall = harness.model.predict.mock.calls[0];
        const secondCall = harness.model.predict.mock.calls[1];
        if (!firstCall || !secondCall) {
            throw new Error('Expected both DDSP model predictions');
        }
        const firstPitch = (firstCall[0] as { f0_hz: FakeTensor }).f0_hz.values;
        const secondPitch = (secondCall[0] as { f0_hz: FakeTensor }).f0_hz.values;
        expect(firstPitch.slice(0, 3)).toEqual(new Float32Array([100, 101, 102]));
        expect(secondPitch.slice(0, 3)).toEqual(new Float32Array([1_100, 1_101, 1_102]));
        expect(secondPitch[499]).toBe(1_599);
        expect(secondPitch[500]).toBe(-1);

        const response = harness.responses.at(-1);
        if (response?.type !== 'ddsp-result') {
            throw new Error('Expected DDSP result');
        }
        expect(response.audio).toHaveLength(96_000);
        expect(response.audio[63_999]).toBe(1);
        expect(response.audio[64_000]).toBeCloseTo(1, 6);
        expect(response.audio[72_000]).toBeCloseTo(2, 6);
        expect(response.audio[79_999]).toBeCloseTo(3, 3);
        expect(response.audio[80_000]).toBe(3);
    });

    it('stops before predicting a later chunk when the request is cancelled', async () => {
        const firstData = deferred<Float32Array>();
        const harness = createHarness({
            predict: vi.fn(() => fakeTensor(new Float32Array(80_000), firstData.promise)),
        });
        await harness.runtime.handleRequest(createSessionRequest('load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('cancel-inference', 1_500));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());

        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'cancel-inference' });
        firstData.resolve(new Float32Array(80_000));
        await inference;

        expect(harness.model.predict).toHaveBeenCalledOnce();
        expect(harness.responses.some((response) => response.type === 'ddsp-result')).toBe(false);
    });

    it('publishes only the backend reported by the selected TF.js runtime', async () => {
        const harness = createHarness({ backend: 'webgpu' });
        await harness.runtime.handleRequest(createSessionRequest('load'));
        await harness.runtime.handleRequest(inferenceRequest('render', 125));
        expect(harness.responses.at(-1)).toMatchObject({ type: 'ddsp-result', backend: 'webgpu' });

        harness.backend.value = 'wasm';
        await harness.runtime.handleRequest(inferenceRequest('wrong-backend', 125));
        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'wrong-backend',
            error: expect.stringContaining('wasm'),
        });
    });
});
