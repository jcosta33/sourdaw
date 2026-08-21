import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';
import {
    createTfjsInferenceRequestHandler,
    requireHardwareWebGpu,
    type TfjsWorkerModel,
    type TfjsWorkerRuntime,
    type TfjsWorkerTensor,
} from '../tfjsInferenceWorkerRuntime';

type Deferred<TValue> = {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
};

type FakeTensor = TfjsWorkerTensor & {
    dispose: Mock<() => void>;
    values: Float32Array;
};

type Harness = {
    backend: { value: string };
    loadGraphModel: Mock<TfjsWorkerRuntime['loadGraphModel']>;
    model: { dispose: Mock<() => void>; predict: Mock<TfjsWorkerModel['predict']> };
    responses: WorkerResponse[];
    runtime: ReturnType<typeof createTfjsInferenceRequestHandler>;
    tensor1d: Mock<TfjsWorkerRuntime['tensor1d']>;
};

const MODEL_FRAME_LENGTH = 4;
const MODEL_JSON = new TextEncoder().encode(
    JSON.stringify({
        format: 'graph-model',
        generatedBy: 'fixture',
        modelTopology: { node: [] },
        weightsManifest: [
            {
                paths: ['group1-shard1of1.bin'],
                weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
            },
        ],
    })
).buffer;
const WEIGHTS = Uint8Array.from([1, 2, 3, 4]).buffer;
type SettingsFixture = {
    averageMaxLoudness: number;
    loudnessThreshold: number;
    meanLoudness: number;
    meanPitch: number;
    postGain: number;
    modelMaxFrameLength: number;
};
const SETTINGS_VALUES: SettingsFixture = {
    averageMaxLoudness: -48.6,
    loudnessThreshold: -100,
    meanLoudness: -68.5,
    meanPitch: 62,
    postGain: 2,
    modelMaxFrameLength: MODEL_FRAME_LENGTH,
};

function settingsBytes(overrides: Partial<SettingsFixture> = {}): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify({ ...SETTINGS_VALUES, ...overrides })).buffer;
}

const SETTINGS = settingsBytes();

function deferred<TValue>(): Deferred<TValue> {
    let resolveDeferred: (value: TValue) => void = () => undefined;
    const promise = new Promise<TValue>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function artifactPort(bytes: ArrayBuffer, mode: 'data' | 'error' | 'pending' = 'data'): MessagePort {
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
                        new MessageEvent('message', { data: { type: 'model-error', message: 'storage read failed' } })
                    );
                }
            });
        }),
    };
    return port as unknown as MessagePort;
}

function artifacts(
    overrides: Partial<Record<DdspStoredArtifact['path'], MessagePort>> = {},
    modelJson = MODEL_JSON,
    settings = SETTINGS
): DdspStoredArtifact[] {
    return [
        {
            path: 'model.json',
            sizeBytes: modelJson.byteLength,
            sha256: 'a'.repeat(64),
            modelDataPort: overrides['model.json'] ?? artifactPort(modelJson),
        },
        {
            path: 'group1-shard1of1.bin',
            sizeBytes: WEIGHTS.byteLength,
            sha256: 'b'.repeat(64),
            modelDataPort: overrides['group1-shard1of1.bin'] ?? artifactPort(WEIGHTS),
        },
        {
            path: 'settings.json',
            sizeBytes: settings.byteLength,
            sha256: 'c'.repeat(64),
            modelDataPort: overrides['settings.json'] ?? artifactPort(settings),
        },
    ];
}

function sessionRequest(
    requestId: string,
    sessionArtifacts = artifacts(),
    sessionKey = 'ddsp-violin:v1:fingerprint'
): WorkerRequest {
    return {
        type: 'create-ddsp-session',
        requestId,
        sessionKey,
        artifacts: sessionArtifacts,
    };
}

function inferenceRequest(requestId: string, sessionKey = 'ddsp-violin:v1:fingerprint'): WorkerRequest {
    return {
        type: 'run-ddsp-inference',
        requestId,
        sessionKey,
        f0Hz: Float32Array.from([220, 221, 222, 223]),
        loudnessDb: Float32Array.from([-60, -59, -58, -57]),
    };
}

function fakeTensor(
    values: Float32Array,
    options: { data?: Promise<Float32Array>; shape?: readonly number[] } = {}
): FakeTensor {
    return {
        data: vi.fn(() => options.data ?? Promise.resolve(values)),
        dispose: vi.fn(),
        dtype: 'float32',
        shape: options.shape ?? [1, values.length],
        values,
    };
}

const runtimes: Array<ReturnType<typeof createTfjsInferenceRequestHandler>> = [];

function createHarness(input: { backend?: string; output?: FakeTensor } = {}): Harness {
    const backend = { value: input.backend ?? 'webgpu' };
    const output = input.output ?? fakeTensor(Float32Array.from([0.1, -0.2, 0.3, -0.4]));
    const model = { dispose: vi.fn(), predict: vi.fn(() => output) };
    const loadGraphModel = vi.fn(async (handler: { load: () => Promise<unknown> }) => {
        await handler.load();
        return model;
    });
    const tensor1d = vi.fn((values: Float32Array) => fakeTensor(Float32Array.from(values), { shape: [values.length] }));
    const responses: WorkerResponse[] = [];
    const runtime = createTfjsInferenceRequestHandler({
        initializeTfjs: vi.fn(async () => ({
            getBackend: () => backend.value,
            loadGraphModel,
            tensor1d,
        })),
        postResponse: (response) => responses.push(response),
    });
    runtimes.push(runtime);
    return { backend, loadGraphModel, model, responses, runtime, tensor1d };
}

afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
        await runtime.dispose();
    }
    vi.useRealTimers();
});

describe('tfjsInferenceWorkerRuntime', () => {
    it('rejects missing, unproven, or fallback WebGPU adapters', async () => {
        await expect(requireHardwareWebGpu(undefined)).rejects.toThrow('hardware WebGPU');
        await expect(
            requireHardwareWebGpu({
                requestAdapter: vi.fn().mockResolvedValue({ info: {} }),
            } as unknown as GPU)
        ).rejects.toThrow('hardware WebGPU');
        await expect(
            requireHardwareWebGpu({
                requestAdapter: vi.fn().mockResolvedValue({ info: { isFallbackAdapter: true } }),
            } as unknown as GPU)
        ).rejects.toThrow('hardware WebGPU');
    });

    it('admits only a proven non-fallback core WebGPU adapter', async () => {
        const device = {} as GPUDevice;
        const requestDevice = vi.fn().mockResolvedValue(device);
        const adapter = {
            features: new Set<GPUFeatureName>(['timestamp-query', 'bgra8unorm-storage']),
            info: { isFallbackAdapter: false },
            limits: {
                maxComputeWorkgroupStorageSize: 1,
                maxComputeWorkgroupsPerDimension: 2,
                maxStorageBufferBindingSize: 3,
                maxBufferSize: 4,
                maxComputeWorkgroupSizeX: 5,
                maxComputeInvocationsPerWorkgroup: 6,
            },
            requestDevice,
        } as unknown as GPUAdapter;
        const requestAdapter = vi.fn().mockResolvedValue(adapter);

        await expect(requireHardwareWebGpu({ requestAdapter } as unknown as GPU)).resolves.toEqual({ adapter, device });
        expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({
            powerPreference: 'high-performance',
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
        expect(requestDevice).toHaveBeenCalledExactlyOnceWith({
            requiredFeatures: ['timestamp-query', 'bgra8unorm-storage'],
            requiredLimits: {
                maxComputeWorkgroupStorageSize: 1,
                maxComputeWorkgroupsPerDimension: 2,
                maxStorageBufferBindingSize: 3,
                maxBufferSize: 4,
                maxComputeWorkgroupSizeX: 5,
                maxComputeInvocationsPerWorkgroup: 6,
            },
        });
    });

    it('loads one session from verified artifact ports through an in-memory IO handler', async () => {
        const harness = createHarness();
        const transferred = artifacts();

        await harness.runtime.handleRequest(sessionRequest('load', transferred));

        expect(harness.loadGraphModel).toHaveBeenCalledOnce();
        const handler = harness.loadGraphModel.mock.calls[0]?.[0];
        if (!handler) {
            throw new Error('Expected a GraphModel IO handler');
        }
        await expect(handler.load()).resolves.toMatchObject({
            modelTopology: { node: [] },
            weightData: WEIGHTS,
            weightSpecs: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
        });
        expect(harness.responses).toContainEqual({
            type: 'session-created',
            requestId: 'load',
            sessionKey: 'ddsp-violin:v1:fingerprint',
            backend: 'webgpu',
            modelFrameLength: MODEL_FRAME_LENGTH,
        });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('fails closed when the selected backend is not exactly webgpu', async () => {
        const harness = createHarness({ backend: 'cpu' });
        const transferred = artifacts();

        await harness.runtime.handleRequest(sessionRequest('wrong-backend', transferred));

        expect(harness.loadGraphModel).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'wrong-backend',
            error: expect.stringContaining('cpu'),
        });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('rejects incomplete or malformed model metadata and closes every port', async () => {
        const malformedModel = new TextEncoder().encode(
            JSON.stringify({ modelTopology: {}, weightsManifest: [{ paths: ['network.bin'], weights: [] }] })
        ).buffer;
        const cases = [artifacts().slice(0, 2), artifacts({}, malformedModel)];

        for (const [index, transferred] of cases.entries()) {
            const harness = createHarness();
            await harness.runtime.handleRequest(sessionRequest(`bad-${String(index)}`, transferred));
            expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: `bad-${String(index)}` });
            for (const artifact of transferred) {
                expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
            }
        }
    });

    it('rejects artifact metadata that cannot represent a verified transfer', async () => {
        const harness = createHarness();
        const transferred = artifacts();
        transferred[0]!.sha256 = 'not-a-sha256';

        await harness.runtime.handleRequest(sessionRequest('bad-artifact-metadata', transferred));

        expect(harness.loadGraphModel).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toMatchObject({
            type: 'error',
            requestId: 'bad-artifact-metadata',
        });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('closes every port when storage reports an artifact read error', async () => {
        const harness = createHarness();
        const transferred = artifacts({ 'model.json': artifactPort(MODEL_JSON, 'error') });

        await harness.runtime.handleRequest(sessionRequest('read-error', transferred));

        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'read-error',
            error: 'storage read failed',
        });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('rejects an artifact transfer whose byte length differs from verified metadata', async () => {
        const harness = createHarness();
        const transferred = artifacts();
        transferred[0] = { ...transferred[0]!, sizeBytes: transferred[0]!.sizeBytes + 1 };

        await harness.runtime.handleRequest(sessionRequest('size-drift', transferred));

        expect(harness.loadGraphModel).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toEqual({
            type: 'error',
            requestId: 'size-drift',
            error: 'DDSP artifact transfer size drifted: model.json',
        });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it.each([
        ['non-positive postGain', { postGain: 0 }],
        ['non-positive modelMaxFrameLength', { modelMaxFrameLength: 0 }],
        ['non-integer modelMaxFrameLength', { modelMaxFrameLength: 1.5 }],
    ] as const)('rejects settings with %s and closes every port', async (_label, overrides) => {
        const harness = createHarness();
        const transferred = artifacts({}, MODEL_JSON, settingsBytes(overrides));

        await harness.runtime.handleRequest(sessionRequest('invalid-settings', transferred));

        expect(harness.loadGraphModel).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'invalid-settings' });
        for (const artifact of transferred) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('reuses an exact cached session and closes duplicate transferred ports unused', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('first'));
        const duplicate = artifacts();

        await harness.runtime.handleRequest(sessionRequest('second', duplicate));

        expect(harness.loadGraphModel).toHaveBeenCalledOnce();
        expect(harness.responses.at(-1)).toMatchObject({ type: 'session-created', requestId: 'second' });
        for (const artifact of duplicate) {
            expect(artifact.modelDataPort.start).not.toHaveBeenCalled();
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('keeps a loaded session usable across the former 55-second runtime eviction window', async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('load'));

        await vi.advanceTimersByTimeAsync(56_000);
        await harness.runtime.handleRequest(inferenceRequest('after-former-eviction'));

        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toMatchObject({
            type: 'ddsp-result',
            requestId: 'after-former-eviction',
        });
    });

    it('runs raw fixed-shape features and disposes every input and output tensor once', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('infer'));

        expect(harness.model.predict).toHaveBeenCalledOnce();
        const feeds = harness.model.predict.mock.calls[0]?.[0];
        expect(feeds).toEqual({
            f0_hz: expect.objectContaining({ values: Float32Array.from([220, 221, 222, 223]) }),
            loudness_db: expect.objectContaining({ values: Float32Array.from([-60, -59, -58, -57]) }),
        });
        expect(harness.responses.at(-1)).toMatchObject({
            type: 'ddsp-result',
            requestId: 'infer',
            backend: 'webgpu',
            audio: Float32Array.from([0.1, -0.2, 0.3, -0.4]),
        });
        for (const tensor of harness.tensor1d.mock.results.map(({ value }) => value)) {
            expect(tensor.dispose).toHaveBeenCalledOnce();
        }
        const output = harness.model.predict.mock.results[0]?.value;
        if (Array.isArray(output) || output === undefined || !('dispose' in output)) {
            throw new Error('Expected one output tensor');
        }
        expect(output.dispose).toHaveBeenCalledOnce();
    });

    it('rechecks the WebGPU backend before inference after a session is loaded', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('load'));
        harness.backend.value = 'wasm';

        await harness.runtime.handleRequest(inferenceRequest('backend-changed'));

        expect(harness.model.predict).not.toHaveBeenCalled();
        expect(harness.responses).toContainEqual({
            type: 'error',
            requestId: 'backend-changed',
            error: expect.stringContaining('wasm'),
        });
        expect(harness.responses).not.toContainEqual(
            expect.objectContaining({ type: 'ddsp-result', requestId: 'backend-changed' })
        );
    });

    it.each([
        {
            name: 'mismatched input lengths',
            mutate: (request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>) => {
                request.loudnessDb = new Float32Array(3);
            },
        },
        {
            name: 'wrong fixed frame length',
            mutate: (request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>) => {
                request.f0Hz = new Float32Array(3);
                request.loudnessDb = new Float32Array(3);
            },
        },
        {
            name: 'non-finite features',
            mutate: (request: Extract<WorkerRequest, { type: 'run-ddsp-inference' }>) => {
                request.f0Hz[1] = Number.NaN;
            },
        },
    ])('rejects $name before prediction', async ({ mutate }) => {
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('load'));
        const request = inferenceRequest('invalid');
        if (request.type !== 'run-ddsp-inference') {
            throw new Error('Expected inference request');
        }
        mutate(request);

        await harness.runtime.handleRequest(request);

        expect(harness.model.predict).not.toHaveBeenCalled();
        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'invalid' });
    });

    it('rejects a non-finite or shape-inconsistent output and still disposes it', async () => {
        const output = fakeTensor(Float32Array.from([1, Number.NaN]), { shape: [1, 3] });
        const harness = createHarness({ output });
        await harness.runtime.handleRequest(sessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('bad-output'));

        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'bad-output' });
        expect(output.dispose).toHaveBeenCalledOnce();
    });

    it('disposes a repeated prediction tensor exactly once on a malformed multi-output result', async () => {
        const output = fakeTensor(new Float32Array(4));
        const harness = createHarness();
        harness.model.predict.mockReturnValue([output, output]);
        await harness.runtime.handleRequest(sessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('duplicate-output'));

        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'duplicate-output' });
        expect(output.dispose).toHaveBeenCalledOnce();
    });

    it('disposes a partial input allocation when the sibling tensor allocation fails', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(sessionRequest('load'));
        const pitch = fakeTensor(new Float32Array(MODEL_FRAME_LENGTH));
        harness.tensor1d
            .mockReset()
            .mockReturnValueOnce(pitch)
            .mockImplementationOnce(() => {
                throw new Error('loudness allocation failed');
            });

        await harness.runtime.handleRequest(inferenceRequest('allocation-failure'));

        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'allocation-failure' });
        expect(pitch.dispose).toHaveBeenCalledOnce();
    });

    it('disposes valid prediction tensors beside an invalid tensor-map entry', async () => {
        const output = fakeTensor(new Float32Array(MODEL_FRAME_LENGTH));
        const harness = createHarness();
        harness.model.predict.mockReturnValue({ metadata: null as unknown as TfjsWorkerTensor, audio: output });
        await harness.runtime.handleRequest(sessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('invalid-output-map'));

        expect(harness.responses.at(-1)).toMatchObject({ type: 'error', requestId: 'invalid-output-map' });
        expect(output.dispose).toHaveBeenCalledOnce();
    });

    it('closes transferred ports for a duplicate active request id', async () => {
        const modelLoad = deferred<TfjsWorkerModel>();
        const harness = createHarness();
        harness.loadGraphModel.mockImplementation(async (handler) => {
            await handler.load();
            return modelLoad.promise;
        });
        const original = harness.runtime.handleRequest(sessionRequest('duplicate'));
        await vi.waitFor(() => expect(harness.loadGraphModel).toHaveBeenCalledOnce());
        const duplicatePorts = artifacts();

        await harness.runtime.handleRequest(sessionRequest('duplicate', duplicatePorts));
        modelLoad.resolve(harness.model);
        await original;

        expect(harness.responses).toContainEqual({
            type: 'error',
            requestId: 'duplicate',
            error: 'Duplicate DDSP request id',
        });
        for (const artifact of duplicatePorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('cancels one inference without disturbing a sibling session request', async () => {
        const cancelledData = deferred<Float32Array>();
        const keptData = deferred<Float32Array>();
        const cancelledOutput = fakeTensor(new Float32Array(4), { data: cancelledData.promise });
        const keptOutput = fakeTensor(new Float32Array(4), { data: keptData.promise });
        const harness = createHarness();
        harness.model.predict.mockReturnValueOnce(cancelledOutput).mockReturnValueOnce(keptOutput);
        await harness.runtime.handleRequest(sessionRequest('load'));
        const cancelled = harness.runtime.handleRequest(inferenceRequest('cancelled'));
        const kept = harness.runtime.handleRequest(inferenceRequest('kept'));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledTimes(2));

        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'cancelled' });
        cancelledData.resolve(new Float32Array(4));
        keptData.resolve(Float32Array.from([1, 2, 3, 4]));
        await Promise.all([cancelled, kept]);

        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'error', requestId: 'cancelled', error: expect.stringContaining('cancel') })
        );
        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'ddsp-result', requestId: 'kept', audio: Float32Array.from([1, 2, 3, 4]) })
        );
        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(cancelledOutput.dispose).toHaveBeenCalledOnce();
        expect(keptOutput.dispose).toHaveBeenCalledOnce();
    });

    it('keeps a sibling model session alive after targeted cancellation', async () => {
        const cancelledData = deferred<Float32Array>();
        const keptData = deferred<Float32Array>();
        const cancelledOutput = fakeTensor(new Float32Array(4), { data: cancelledData.promise });
        const keptOutput = fakeTensor(new Float32Array(4), { data: keptData.promise });
        const harness = createHarness();
        harness.model.predict.mockReturnValue(cancelledOutput);
        const siblingModel: TfjsWorkerModel = {
            dispose: vi.fn(),
            predict: vi.fn(() => keptOutput),
        };
        harness.loadGraphModel
            .mockImplementationOnce(async (handler) => {
                await handler.load();
                return harness.model;
            })
            .mockImplementationOnce(async (handler) => {
                await handler.load();
                return siblingModel;
            });
        const siblingKey = 'ddsp-flute:v1:fingerprint';
        await harness.runtime.handleRequest(sessionRequest('load-violin'));
        await harness.runtime.handleRequest(sessionRequest('load-flute', artifacts(), siblingKey));

        const cancelled = harness.runtime.handleRequest(inferenceRequest('cancel-violin'));
        const kept = harness.runtime.handleRequest(inferenceRequest('keep-flute', siblingKey));
        await vi.waitFor(() => expect(siblingModel.predict).toHaveBeenCalledOnce());
        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'cancel-violin' });

        cancelledData.resolve(new Float32Array(4));
        keptData.resolve(Float32Array.from([1, 2, 3, 4]));
        await Promise.all([cancelled, kept]);

        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'error', requestId: 'cancel-violin' })
        );
        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'ddsp-result', requestId: 'keep-flute' })
        );
        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(siblingModel.dispose).not.toHaveBeenCalled();
    });

    it('drains active inference before disposing and acknowledging session release', async () => {
        const outputData = deferred<Float32Array>();
        const output = fakeTensor(new Float32Array(4), { data: outputData.promise });
        const harness = createHarness({ output });
        await harness.runtime.handleRequest(sessionRequest('load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('active'));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());

        const release = harness.runtime.handleRequest({
            type: 'release-ddsp-session',
            requestId: 'release',
            sessionKey: 'ddsp-violin:v1:fingerprint',
        });
        await Promise.resolve();
        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(harness.responses).not.toContainEqual(expect.objectContaining({ type: 'ddsp-session-released' }));

        outputData.resolve(new Float32Array(4));
        await Promise.all([inference, release]);

        expect(output.dispose).toHaveBeenCalledOnce();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
        expect(harness.responses.at(-1)).toEqual({
            type: 'ddsp-session-released',
            requestId: 'release',
            sessionKey: 'ddsp-violin:v1:fingerprint',
        });
    });

    it('honors cancellation while a new session request waits for prior release', async () => {
        const outputData = deferred<Float32Array>();
        const harness = createHarness({ output: fakeTensor(new Float32Array(4), { data: outputData.promise }) });
        await harness.runtime.handleRequest(sessionRequest('load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('active'));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());
        const release = harness.runtime.handleRequest({
            type: 'release-ddsp-session',
            requestId: 'release',
            sessionKey: 'ddsp-violin:v1:fingerprint',
        });
        const queuedPorts = artifacts();
        const queued = harness.runtime.handleRequest(sessionRequest('queued', queuedPorts));

        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'queued' });
        outputData.resolve(new Float32Array(4));
        await Promise.all([inference, release, queued]);

        expect(harness.loadGraphModel).toHaveBeenCalledOnce();
        expect(harness.responses).toContainEqual({
            type: 'error',
            requestId: 'queued',
            error: 'DDSP request cancelled',
        });
        for (const artifact of queuedPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('treats consecutive releases as ordered barriers around queued session work', async () => {
        const activeOutput = deferred<Float32Array>();
        const harness = createHarness({ output: fakeTensor(new Float32Array(4), { data: activeOutput.promise }) });
        const replacementModel: TfjsWorkerModel = {
            dispose: vi.fn(),
            predict: vi.fn(() => fakeTensor(Float32Array.from([1, 2, 3, 4]))),
        };
        harness.loadGraphModel
            .mockImplementationOnce(async (handler) => {
                await handler.load();
                return harness.model;
            })
            .mockImplementationOnce(async (handler) => {
                await handler.load();
                return replacementModel;
            });
        await harness.runtime.handleRequest(sessionRequest('initial-load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('active'));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());

        const release1 = harness.runtime.handleRequest({
            type: 'release-ddsp-session',
            requestId: 'release-1',
            sessionKey: 'ddsp-violin:v1:fingerprint',
        });
        const queuedPorts = artifacts();
        const queuedBeforeRelease2 = harness.runtime.handleRequest(
            sessionRequest('queued-before-release-2', queuedPorts)
        );
        const release2 = harness.runtime.handleRequest({
            type: 'release-ddsp-session',
            requestId: 'release-2',
            sessionKey: 'ddsp-violin:v1:fingerprint',
        });
        const afterRelease2 = harness.runtime.handleRequest(sessionRequest('after-release-2'));

        activeOutput.resolve(new Float32Array(4));
        await Promise.all([inference, release1, queuedBeforeRelease2, release2, afterRelease2]);

        expect(harness.responses).toContainEqual({
            type: 'error',
            requestId: 'queued-before-release-2',
            error: 'DDSP request cancelled',
        });
        expect(harness.responses).not.toContainEqual(
            expect.objectContaining({ type: 'session-created', requestId: 'queued-before-release-2' })
        );
        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'session-created', requestId: 'after-release-2' })
        );
        expect(harness.loadGraphModel).toHaveBeenCalledTimes(2);
        for (const artifact of queuedPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
        expect(replacementModel.dispose).not.toHaveBeenCalled();
    });

    it('drains all active work before acknowledging worker disposal', async () => {
        const outputData = deferred<Float32Array>();
        const harness = createHarness({ output: fakeTensor(new Float32Array(4), { data: outputData.promise }) });
        await harness.runtime.handleRequest(sessionRequest('load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('active'));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());

        const disposal = harness.runtime.handleRequest({ type: 'dispose-worker', requestId: 'dispose' });
        await Promise.resolve();
        expect(harness.responses).not.toContainEqual(expect.objectContaining({ type: 'worker-disposed' }));

        outputData.resolve(new Float32Array(4));
        await Promise.all([inference, disposal]);

        expect(harness.model.dispose).toHaveBeenCalledOnce();
        expect(harness.responses.at(-1)).toEqual({ type: 'worker-disposed', requestId: 'dispose' });
    });

    it('keeps a shared session load alive when only one subscriber is cancelled', async () => {
        const modelLoad = deferred<TfjsWorkerModel>();
        const harness = createHarness();
        harness.loadGraphModel.mockImplementation(async (handler) => {
            await handler.load();
            return modelLoad.promise;
        });
        const first = harness.runtime.handleRequest(sessionRequest('first'));
        await vi.waitFor(() => expect(harness.loadGraphModel).toHaveBeenCalledOnce());
        const duplicatePorts = artifacts();
        const second = harness.runtime.handleRequest(sessionRequest('second', duplicatePorts));

        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'first' });
        modelLoad.resolve(harness.model);
        await Promise.all([first, second]);

        expect(harness.responses).toContainEqual(expect.objectContaining({ type: 'error', requestId: 'first' }));
        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'session-created', requestId: 'second' })
        );
        expect(harness.model.dispose).not.toHaveBeenCalled();
        for (const artifact of duplicatePorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });
});
