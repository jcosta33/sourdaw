import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type DdspStoredArtifact, type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';
import { midiToDdspInput } from '../../services/midiToDdspInput';
import {
    createTfjsInferenceRequestHandler,
    parseDdspSettings,
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
const VIOLIN_SETTINGS = {
    averageMaxLoudness: -48.6,
    loudnessThreshold: -100,
    meanLoudness: -68.5,
    meanPitch: 62,
    postGain: 2,
    modelMaxFrameLength: 1_250,
};
const TRUMPET_SETTINGS = {
    averageMaxLoudness: -61.7,
    loudnessThreshold: -100,
    meanLoudness: -72.5,
    meanPitch: 68.6,
    postGain: 1.5,
    modelMaxFrameLength: 1_250,
};
const SETTINGS = settingsBytes(VIOLIN_SETTINGS);
const WEIGHTS = Uint8Array.from([1, 2, 3]).buffer;

function settingsBytes(settings: Record<string, number>): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify(settings)).buffer;
}

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

function artifacts(
    overrides: Partial<Record<DdspStoredArtifact['path'], MessagePort>> = {},
    settings = SETTINGS
): DdspStoredArtifact[] {
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
            sizeBytes: settings.byteLength,
            sha256: 'c'.repeat(64),
            modelDataPort: overrides['settings.json'] ?? artifactPort(settings),
        },
    ];
}

function createSessionRequest(
    requestId: string,
    requestArtifacts = artifacts(),
    modelId = 'ddsp-violin:v1'
): WorkerRequest {
    return {
        type: 'create-session-from-model-storage',
        requestId,
        modelId,
        artifacts: requestArtifacts,
    };
}

function inferenceRequest(requestId: string, frameCount: number, modelId = 'ddsp-violin:v1'): WorkerRequest {
    return {
        type: 'run-ddsp-inference',
        requestId,
        modelId,
        pitchHz: Float32Array.from({ length: frameCount }, (_, index) => 100 + index),
        loudnessDb: Float32Array.from({ length: frameCount }, (_, index) => -60 + index / 100),
        frameRate: 250,
    };
}

function exactInferenceRequest(
    requestId: string,
    pitchHz: readonly number[],
    loudnessDb: readonly number[],
    frameRate = 250
): WorkerRequest {
    return {
        type: 'run-ddsp-inference',
        requestId,
        modelId: 'ddsp-violin:v1',
        pitchHz: Float32Array.from(pitchHz),
        loudnessDb: Float32Array.from(loudnessDb),
        frameRate,
    };
}

function expectArrayClose(actual: Float32Array, expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);
    for (const [index, value] of expected.entries()) {
        expect(actual[index]).toBeCloseTo(value, 4);
    }
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

async function predictConditionedFeatures(
    pitchHz: Float32Array,
    loudnessDb: Float32Array,
    settings = VIOLIN_SETTINGS
): Promise<{ f0_hz: Float32Array; loudness_db: Float32Array }> {
    const harness = createHarness();
    await harness.runtime.handleRequest(createSessionRequest('load', artifacts({}, settingsBytes(settings))));
    await harness.runtime.handleRequest(
        exactInferenceRequest('condition', Array.from(pitchHz), Array.from(loudnessDb))
    );
    const feeds = harness.model.predict.mock.calls[0]?.[0] as
        { f0_hz: FakeTensor; loudness_db: FakeTensor } | undefined;
    if (!feeds) {
        throw new Error('Expected conditioned DDSP prediction');
    }
    return { f0_hz: feeds.f0_hz.values, loudness_db: feeds.loudness_db.values };
}

const runtimes: Runtime[] = [];

afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
        await runtime.dispose();
    }
    vi.useRealTimers();
});

describe('tfjsInferenceWorkerRuntime', () => {
    it('should parse every required checkpoint conditioning field', () => {
        expect(parseDdspSettings(SETTINGS)).toEqual(VIOLIN_SETTINGS);
    });

    it.each([
        ['averageMaxLoudness', 1],
        ['loudnessThreshold', -121],
        ['meanLoudness', 1],
        ['meanPitch', 111],
        ['postGain', 0],
        ['modelMaxFrameLength', 1],
    ] as const)('should reject missing, non-finite, and out-of-range %s settings', (field, outOfRange) => {
        const missing = { ...VIOLIN_SETTINGS } as Record<string, number>;
        delete missing[field];
        expect(() => parseDdspSettings(settingsBytes(missing))).toThrow(field);

        const validJson = JSON.stringify(VIOLIN_SETTINGS);
        const nonFiniteJson = validJson.replace(`"${field}":${String(VIOLIN_SETTINGS[field])}`, `"${field}":1e400`);
        expect(() => parseDdspSettings(new TextEncoder().encode(nonFiniteJson).buffer)).toThrow(field);
        expect(() => parseDdspSettings(settingsBytes({ ...VIOLIN_SETTINGS, [field]: outOfRange }))).toThrow(field);
    });

    it.each([
        {
            name: 'violin',
            settings: VIOLIN_SETTINGS,
            expectedPitch: [0, 110, 220, 440],
            expectedLoudness: [-120, -88.43872, -68.39981, -48.46109],
        },
        {
            name: 'trumpet',
            settings: TRUMPET_SETTINGS,
            expectedPitch: [0, 110, 220, 440],
            expectedLoudness: [-120, -102.78986, -83.12112, -63.45238],
        },
    ])('should normalize fixed MIDI features for the $name checkpoint before prediction', async (example) => {
        const harness = createHarness();
        await harness.runtime.handleRequest(
            createSessionRequest('load', artifacts({}, settingsBytes(example.settings)))
        );

        await harness.runtime.handleRequest(
            exactInferenceRequest('condition', [0, 440, 880, 1_760], [-120, -60, -40, -20])
        );

        const feeds = harness.model.predict.mock.calls[0]?.[0] as
            { f0_hz: FakeTensor; loudness_db: FakeTensor } | undefined;
        if (!feeds) {
            throw new Error('Expected conditioned DDSP prediction');
        }
        expectArrayClose(feeds.f0_hz.values.subarray(0, 4), example.expectedPitch);
        expectArrayClose(feeds.loudness_db.values.subarray(0, 4), example.expectedLoudness);
    });

    it('should preserve silence and use the model sentinel values only for chunk padding', async () => {
        const harness = createHarness();
        await harness.runtime.handleRequest(
            createSessionRequest('load', artifacts({}, settingsBytes({ ...VIOLIN_SETTINGS, modelMaxFrameLength: 4 })))
        );

        await harness.runtime.handleRequest(exactInferenceRequest('silence', [0, 0], [-120, -120]));

        const feeds = harness.model.predict.mock.calls[0]?.[0] as
            { f0_hz: FakeTensor; loudness_db: FakeTensor } | undefined;
        if (!feeds) {
            throw new Error('Expected silent DDSP prediction');
        }
        expect(feeds.f0_hz.values).toEqual(new Float32Array([0, 0, -1, -1]));
        expect(feeds.loudness_db.values).toEqual(new Float32Array([-120, -120, -120, -120]));
    });

    it('should apply checkpoint postGain to model audio before publishing', async () => {
        const modelAudio = new Float32Array(80_000).fill(0.25);
        const harness = createHarness({ predict: vi.fn(() => fakeTensor(modelAudio, modelAudio)) });
        await harness.runtime.handleRequest(createSessionRequest('load'));

        await harness.runtime.handleRequest(inferenceRequest('post-gain', 125));

        const response = harness.responses.at(-1);
        if (response?.type !== 'ddsp-result') {
            throw new Error('Expected DDSP result');
        }
        expect(response.audio[0]).toBeCloseTo(0.5, 6);
        expect(response.audio.at(-1)).toBeCloseTo(0.5, 6);
    });

    it('should keep the voiced register invariant when identical notes gain leading and trailing rests', async () => {
        const voicedPitch = Float32Array.from([110, 110, 110, 110]);
        const voicedLoudness = Float32Array.from([-80, -60, -50, -70]);
        const bare = await predictConditionedFeatures(voicedPitch, voicedLoudness);
        const paddedPitch = Float32Array.from([0, 0, 0, 0, ...voicedPitch, 0, 0, 0, 0, 0, 0]);
        const paddedLoudness = Float32Array.from([
            -120,
            -120,
            -120,
            -120,
            ...voicedLoudness,
            -120,
            -120,
            -120,
            -120,
            -120,
            -120,
        ]);
        const padded = await predictConditionedFeatures(paddedPitch, paddedLoudness);

        expectArrayClose(bare.f0_hz.subarray(0, voicedPitch.length), [220, 220, 220, 220]);
        expectArrayClose(padded.f0_hz.subarray(4, 8), Array.from(bare.f0_hz.subarray(0, 4)));
    });

    it('should not shift the reviewer A4 note to the pitch ceiling when the phrase contains rest padding', async () => {
        const note = [{ pitch: 69, velocity: 100, startSec: 0, durationSec: 0.1 }];
        const shortInput = midiToDdspInput({ notes: note, durationSec: 0.1 });
        const paddedInput = midiToDdspInput({ notes: note, durationSec: 1 });
        const short = await predictConditionedFeatures(shortInput.pitchHz, shortInput.loudnessDb);
        const padded = await predictConditionedFeatures(paddedInput.pitchHz, paddedInput.loudnessDb);

        expect(padded.f0_hz[1]).toBeCloseTo(short.f0_hz[1] ?? 0, 5);
        expect(padded.f0_hz[1]).not.toBeCloseTo(4_698.64, 1);
    });

    it('should leave all-rest pitch at finite zero', async () => {
        const conditioned = await predictConditionedFeatures(new Float32Array(250), new Float32Array(250).fill(-120));

        expect(conditioned.f0_hz.subarray(0, 250).every((pitch) => pitch === 0 && Number.isFinite(pitch))).toBe(true);
    });

    it('should compute pitch register from voiced frames only when two notes are separated by rests', async () => {
        const conditioned = await predictConditionedFeatures(
            Float32Array.from([0, 220, 220, 0, 440, 440, 0]),
            Float32Array.from([-120, -60, -50, -120, -60, -50, -120])
        );

        expectArrayClose(conditioned.f0_hz.subarray(0, 7), [0, 220, 220, 0, 440, 440, 0]);
    });

    it('should still apply a positive checkpoint octave shift to genuinely voiced notes', async () => {
        const conditioned = await predictConditionedFeatures(
            Float32Array.from([110, 110, 220]),
            Float32Array.from([-80, -60, -50])
        );

        expectArrayClose(conditioned.f0_hz.subarray(0, 3), [220, 220, 440]);
    });

    it('should coalesce TF.js initialization and concurrent identical model loads', async () => {
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

    it('should dispose a model exactly once when cancellation makes its completed load a loser', async () => {
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
        await harness.runtime.dispose();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('should dispose a model exactly once when post-load backend validation fails', async () => {
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
        await harness.runtime.dispose();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('should dispose loaded sessions exactly once on release and on idle eviction', async () => {
        vi.useFakeTimers();
        const released = createHarness();
        await released.runtime.handleRequest(createSessionRequest('release-load'));
        await released.runtime.handleRequest({
            type: 'release-session',
            requestId: 'release-session',
            modelId: 'ddsp-violin:v1',
        });
        expect(released.model.dispose).toHaveBeenCalledOnce();
        expect(released.responses.at(-1)).toEqual({
            type: 'session-released',
            requestId: 'release-session',
            modelId: 'ddsp-violin:v1',
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(released.model.dispose).toHaveBeenCalledOnce();

        const idle = createHarness();
        await idle.runtime.handleRequest(createSessionRequest('idle-load'));
        await vi.advanceTimersByTimeAsync(1_000);
        expect(idle.model.dispose).toHaveBeenCalledOnce();
    });

    it('should drain every cancelled same-model inference before releasing and acknowledging the session', async () => {
        const firstData = deferred<Float32Array>();
        const secondData = deferred<Float32Array>();
        const firstOutput = fakeTensor(new Float32Array(80_000), firstData.promise);
        const secondOutput = fakeTensor(new Float32Array(80_000), secondData.promise);
        const harness = createHarness({
            predict: vi.fn().mockReturnValueOnce(firstOutput).mockReturnValueOnce(secondOutput),
        });
        await harness.runtime.handleRequest(createSessionRequest('load'));

        const first = harness.runtime.handleRequest(inferenceRequest('infer-a', 125));
        const second = harness.runtime.handleRequest(inferenceRequest('infer-b', 125));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledTimes(2));
        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'infer-a' });
        await harness.runtime.handleRequest({ type: 'cancel-request', requestId: 'infer-b' });
        const release = harness.runtime.handleRequest({
            type: 'release-session',
            requestId: 'release-after-cancel',
            modelId: 'ddsp-violin:v1',
        });
        await Promise.resolve();

        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(firstOutput.dispose).not.toHaveBeenCalled();
        expect(secondOutput.dispose).not.toHaveBeenCalled();
        expect(harness.responses).not.toContainEqual(expect.objectContaining({ type: 'session-released' }));

        firstData.resolve(new Float32Array(80_000));
        await first;
        await Promise.resolve();
        expect(firstOutput.dispose).toHaveBeenCalledOnce();
        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(harness.responses).not.toContainEqual(expect.objectContaining({ type: 'session-released' }));

        secondData.resolve(new Float32Array(80_000));
        await Promise.all([second, release]);

        expect(secondOutput.dispose).toHaveBeenCalledOnce();
        for (const tensor of harness.tensor1d.mock.results.map((entry) => entry.value as FakeTensor)) {
            expect(tensor.dispose).toHaveBeenCalledOnce();
        }
        expect(harness.model.dispose).toHaveBeenCalledOnce();
        expect(harness.responses.at(-1)).toEqual({
            type: 'session-released',
            requestId: 'release-after-cancel',
            modelId: 'ddsp-violin:v1',
        });
    });

    it('should release one model after its drain without cancelling other-model work', async () => {
        const violinData = deferred<Float32Array>();
        const trumpetData = deferred<Float32Array>();
        const violinModel: FakeModel = {
            predict: vi.fn(() => fakeTensor(new Float32Array(80_000), violinData.promise)),
            dispose: vi.fn(),
        };
        const trumpetModel: FakeModel = {
            predict: vi.fn(() => fakeTensor(new Float32Array(80_000), trumpetData.promise)),
            dispose: vi.fn(),
        };
        const harness = createHarness({
            loadGraphModel: vi
                .fn<TfjsWorkerRuntime['loadGraphModel']>()
                .mockImplementationOnce(async (handler) => {
                    await handler.load();
                    return violinModel;
                })
                .mockImplementationOnce(async (handler) => {
                    await handler.load();
                    return trumpetModel;
                }),
        });
        await harness.runtime.handleRequest(createSessionRequest('load-violin'));
        await harness.runtime.handleRequest(createSessionRequest('load-trumpet', artifacts(), 'ddsp-trumpet:v1'));

        const violin = harness.runtime.handleRequest(inferenceRequest('infer-violin', 125));
        const trumpet = harness.runtime.handleRequest(inferenceRequest('infer-trumpet', 125, 'ddsp-trumpet:v1'));
        await vi.waitFor(() => {
            expect(violinModel.predict).toHaveBeenCalledOnce();
            expect(trumpetModel.predict).toHaveBeenCalledOnce();
        });
        const releaseViolin = harness.runtime.handleRequest({
            type: 'release-session',
            requestId: 'release-violin',
            modelId: 'ddsp-violin:v1',
        });
        violinData.resolve(new Float32Array(80_000));
        await Promise.all([violin, releaseViolin]);

        expect(violinModel.dispose).toHaveBeenCalledOnce();
        expect(trumpetModel.dispose).not.toHaveBeenCalled();
        expect(harness.responses).not.toContainEqual(expect.objectContaining({ requestId: 'infer-trumpet' }));

        trumpetData.resolve(new Float32Array(80_000));
        await trumpet;
        expect(harness.responses).toContainEqual(
            expect.objectContaining({ type: 'ddsp-result', requestId: 'infer-trumpet' })
        );
        expect(trumpetModel.dispose).not.toHaveBeenCalled();
    });

    it('should drain unread output data before dispose-worker tears down the model', async () => {
        const outputData = deferred<Float32Array>();
        const output = fakeTensor(new Float32Array(80_000), outputData.promise);
        const harness = createHarness({ predict: vi.fn(() => output) });
        await harness.runtime.handleRequest(createSessionRequest('load'));
        const inference = harness.runtime.handleRequest(inferenceRequest('infer-before-dispose', 125));
        await vi.waitFor(() => expect(harness.model.predict).toHaveBeenCalledOnce());

        const dispose = harness.runtime.handleRequest({ type: 'dispose-worker' });
        await Promise.resolve();
        expect(harness.model.dispose).not.toHaveBeenCalled();
        expect(output.dispose).not.toHaveBeenCalled();

        outputData.resolve(new Float32Array(80_000));
        await Promise.all([inference, dispose]);

        expect(output.dispose).toHaveBeenCalledOnce();
        expect(harness.model.dispose).toHaveBeenCalledOnce();
    });

    it('should schedule idle disposal after inference failure', async () => {
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

    it('should wait for every overlapping request before disposing an idle session', async () => {
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
    ])('should close every transferred port after $name', async ({ requestArtifacts, expectedError }) => {
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

    it('should close every unread port when the session already exists', async () => {
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

    it('should close every transferred port when GraphModel loading fails', async () => {
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

    it('should close pending load ports when the request is cancelled or the worker is disposed', async () => {
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
        await teardown.runtime.dispose();
        await pending;
        for (const artifact of teardownPorts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('should close every transferred port after a successful model load', async () => {
        const harness = createHarness();
        const loadedArtifacts = artifacts();

        await harness.runtime.handleRequest(createSessionRequest('success', loadedArtifacts));

        for (const artifact of loadedArtifacts) {
            expect(artifact.modelDataPort.close).toHaveBeenCalledOnce();
        }
    });

    it('should crop a short render to its exact requested native-sample duration', async () => {
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

    it('should overlap long inputs in order with the Magenta one-second linear crossfade and exact final length', async () => {
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
        expect(firstPitch.slice(1_000, 1_003)).toEqual(secondPitch.slice(0, 3));
        expect(secondPitch[0]).toBeGreaterThan(0);
        expect(secondPitch[499]).toBeGreaterThan(secondPitch[0] ?? 0);
        expect(secondPitch[500]).toBe(-1);

        const response = harness.responses.at(-1);
        if (response?.type !== 'ddsp-result') {
            throw new Error('Expected DDSP result');
        }
        expect(response.audio).toHaveLength(96_000);
        expect(response.audio[63_999]).toBe(2);
        expect(response.audio[64_000]).toBeCloseTo(2, 6);
        expect(response.audio[72_000]).toBeCloseTo(4, 6);
        expect(response.audio[79_999]).toBeCloseTo(6, 3);
        expect(response.audio[80_000]).toBe(6);
    });

    it('should stop before predicting a later chunk when the request is cancelled', async () => {
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

    it('should publish only the backend reported by the selected TF.js runtime', async () => {
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
