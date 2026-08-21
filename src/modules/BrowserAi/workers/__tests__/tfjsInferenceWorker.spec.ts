import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';

type RuntimeModule = typeof import('../tfjsInferenceWorkerRuntime');
type HandlerInput = Parameters<RuntimeModule['createTfjsInferenceRequestHandler']>[0];
type Runtime = ReturnType<RuntimeModule['createTfjsInferenceRequestHandler']>;
type WorkerTensor = import('../tfjsInferenceWorkerRuntime').TfjsWorkerTensor;

type Deferred<TValue> = {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
};

const shellMocks = vi.hoisted(() => {
    class TensorMock {
        readonly data: ReturnType<typeof vi.fn<() => Promise<ArrayLike<number>>>>;
        readonly dispose = vi.fn();
        readonly dtype: string;
        readonly shape: readonly number[];

        constructor(values: ArrayLike<number>, shape: readonly number[], dtype = 'float32') {
            this.data = vi.fn(async () => values);
            this.dtype = dtype;
            this.shape = shape;
        }
    }
    class WebGPUBackendMock {
        constructor(
            readonly device: GPUDevice,
            readonly adapterInfo: GPUAdapterInfo
        ) {}
    }
    const environment: { global: unknown } = { global: undefined };
    return {
        TensorMock,
        WebGPUBackendMock,
        activeBackendFactory: undefined as undefined | (() => unknown),
        backendImported: vi.fn(),
        concat: vi.fn(),
        createHandler: vi.fn<RuntimeModule['createTfjsInferenceRequestHandler']>(),
        environment,
        env: vi.fn(() => environment),
        getBackend: vi.fn(() => 'webgpu'),
        loadGraphModel: vi.fn(),
        ready: vi.fn(async () => undefined),
        registerBackend: vi.fn(),
        registerOp: vi.fn(),
        removeBackend: vi.fn(),
        requireHardwareWebGpu: vi.fn<RuntimeModule['requireHardwareWebGpu']>(),
        setBackend: vi.fn(async () => true),
        split: vi.fn(),
        tensor1d: vi.fn(),
    };
});

vi.mock('../tfjsInferenceWorkerRuntime', () => ({
    createTfjsInferenceRequestHandler: shellMocks.createHandler,
    requireHardwareWebGpu: shellMocks.requireHardwareWebGpu,
}));

vi.mock('@tensorflow/tfjs-core', () => ({
    Tensor: shellMocks.TensorMock,
    concat: shellMocks.concat,
    env: shellMocks.env,
    getBackend: shellMocks.getBackend,
    ready: shellMocks.ready,
    registerBackend: shellMocks.registerBackend,
    removeBackend: shellMocks.removeBackend,
    setBackend: shellMocks.setBackend,
    split: shellMocks.split,
    tensor1d: shellMocks.tensor1d,
}));

vi.mock('@tensorflow/tfjs-converter', () => ({
    loadGraphModel: shellMocks.loadGraphModel,
    registerOp: shellMocks.registerOp,
}));

vi.mock('@tensorflow/tfjs-backend-webgpu', () => {
    shellMocks.backendImported();
    shellMocks.registerBackend(
        'webgpu',
        async () => {
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (adapter === null) {
                throw new Error('Automatic TF.js adapter request failed');
            }
            return new shellMocks.WebGPUBackendMock(await adapter.requestDevice(), adapter.info);
        },
        3
    );
    return { WebGPUBackend: shellMocks.WebGPUBackendMock };
});

const originalPostMessage = self.postMessage;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let capturedInput: HandlerInput | undefined;
let runtime: Runtime;
let postMessage: ReturnType<typeof vi.fn>;

function deferred<TValue>(): Deferred<TValue> {
    let resolveDeferred: (value: TValue) => void = () => undefined;
    const promise = new Promise<TValue>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function requireCapturedInput(): HandlerInput {
    if (capturedInput === undefined) {
        throw new Error('TF.js worker shell did not create its runtime');
    }
    return capturedInput;
}

function isWorkerHandler(value: unknown): value is (event: MessageEvent) => void {
    return typeof value === 'function';
}

function requireWorkerHandler(field: 'onmessage' | 'onmessageerror'): (event: MessageEvent) => void {
    const handler: unknown = Reflect.get(self, field);
    if (!isWorkerHandler(handler)) {
        throw new TypeError(`TF.js worker shell did not wire self.${field}`);
    }
    return handler;
}

function isWorkerTensor(value: unknown): value is WorkerTensor {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        typeof Reflect.get(value, 'data') === 'function' &&
        typeof Reflect.get(value, 'dispose') === 'function' &&
        typeof Reflect.get(value, 'dtype') === 'string' &&
        Array.isArray(Reflect.get(value, 'shape'))
    );
}

function requireWorkerTensor(value: unknown): WorkerTensor {
    if (!isWorkerTensor(value)) {
        throw new TypeError('TF.js worker shell did not wrap a tensor');
    }
    return value;
}

function installNavigatorGpu(gpu: object): void {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu } });
}

async function importShell(): Promise<void> {
    await import('../tfjsInferenceWorker');
}

describe('tfjsInferenceWorker', () => {
    beforeEach(() => {
        vi.resetModules();
        capturedInput = undefined;
        postMessage = vi.fn();
        Object.defineProperty(self, 'postMessage', { configurable: true, value: postMessage, writable: true });
        Reflect.set(self, 'onmessage', null);
        Reflect.set(self, 'onmessageerror', null);

        runtime = {
            dispose: vi.fn<Runtime['dispose']>(async () => undefined),
            handleRequest: vi.fn<Runtime['handleRequest']>(async () => undefined),
        };
        shellMocks.createHandler.mockReset();
        shellMocks.createHandler.mockImplementation((input) => {
            capturedInput = input;
            return runtime;
        });
        shellMocks.requireHardwareWebGpu.mockReset();
        shellMocks.requireHardwareWebGpu.mockResolvedValue({
            adapter: { info: { isFallbackAdapter: false } } as GPUAdapter,
            device: { lost: new Promise<GPUDeviceLostInfo>(() => undefined) } as GPUDevice,
        });
        shellMocks.backendImported.mockReset();
        shellMocks.concat.mockReset();
        shellMocks.environment.global = undefined;
        shellMocks.env.mockClear();
        shellMocks.getBackend.mockReset();
        shellMocks.getBackend.mockReturnValue('webgpu');
        shellMocks.loadGraphModel.mockReset();
        shellMocks.ready.mockReset();
        shellMocks.ready.mockResolvedValue(undefined);
        shellMocks.registerBackend.mockReset();
        shellMocks.registerBackend.mockImplementation((_name, factory) => {
            shellMocks.activeBackendFactory = factory;
            return true;
        });
        shellMocks.registerOp.mockReset();
        shellMocks.removeBackend.mockReset();
        shellMocks.removeBackend.mockImplementation(() => {
            shellMocks.activeBackendFactory = undefined;
        });
        shellMocks.setBackend.mockReset();
        shellMocks.setBackend.mockImplementation(async () => {
            await shellMocks.activeBackendFactory?.();
            return true;
        });
        shellMocks.split.mockReset();
        shellMocks.tensor1d.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(self, 'postMessage', {
            configurable: true,
            value: originalPostMessage,
            writable: true,
        });
        Reflect.set(self, 'onmessage', null);
        Reflect.set(self, 'onmessageerror', null);
        if (originalNavigator === undefined) {
            Reflect.deleteProperty(globalThis, 'navigator');
        } else {
            Object.defineProperty(globalThis, 'navigator', originalNavigator);
        }
        vi.restoreAllMocks();
    });

    it('forwards self.onmessage requests to the actual shell runtime', async () => {
        await importShell();
        const request = { type: 'get-status', requestId: 'status' } satisfies WorkerRequest;

        requireWorkerHandler('onmessage')(new MessageEvent('message', { data: request }));

        expect(runtime.handleRequest).toHaveBeenCalledExactlyOnceWith(request);
        expect(shellMocks.createHandler).toHaveBeenCalledOnce();
        expect(shellMocks.requireHardwareWebGpu).not.toHaveBeenCalled();
    });

    it('reports a fatal protocol error and disposes the runtime when self.onmessageerror fires', async () => {
        await importShell();

        requireWorkerHandler('onmessageerror')(new MessageEvent('messageerror'));

        expect(postMessage).toHaveBeenCalledExactlyOnceWith(
            { type: 'worker-fatal-error', error: 'TF.js worker received an unreadable request' },
            undefined
        );
        expect(runtime.dispose).toHaveBeenCalledOnce();
    });

    it('forwards the exact response transfer list through self.postMessage', async () => {
        await importShell();
        const audio = Float32Array.from([0.25, -0.25]);
        const response: WorkerResponse = {
            type: 'ddsp-result',
            requestId: 'render',
            audio,
            nativeSampleRate: 16_000,
            backend: 'webgpu',
        };
        const transfer: Transferable[] = [audio.buffer];

        requireCapturedInput().postResponse(response, transfer);

        expect(postMessage).toHaveBeenCalledExactlyOnceWith(response, { transfer });
    });

    it('pins TF.js to the exact verified hardware device and registers the Roll operation', async () => {
        const device = { lost: new Promise<GPUDeviceLostInfo>(() => undefined) } as GPUDevice;
        const verifiedInfo = { isFallbackAdapter: false, vendor: 'verified-hardware' } as GPUAdapterInfo;
        const verifiedAdapter = { info: verifiedInfo } as GPUAdapter;
        const fallbackAdapter = { info: { isFallbackAdapter: true } } as GPUAdapter;
        const requestAdapter = vi.fn().mockResolvedValueOnce(verifiedAdapter).mockResolvedValue(fallbackAdapter);
        const gpu = { requestAdapter };
        installNavigatorGpu(gpu);
        shellMocks.requireHardwareWebGpu.mockImplementationOnce(async (requestedGpu) => {
            const adapter = await requestedGpu?.requestAdapter({
                powerPreference: 'high-performance',
                featureLevel: 'core',
                forceFallbackAdapter: false,
            });
            if (adapter !== verifiedAdapter) {
                throw new Error('Expected the first hardware adapter');
            }
            return { adapter: verifiedAdapter, device };
        });
        await importShell();

        const tf = await requireCapturedInput().initializeTfjs();

        expect(shellMocks.requireHardwareWebGpu).toHaveBeenCalledExactlyOnceWith(gpu);
        expect(requestAdapter).toHaveBeenCalledOnce();
        expect(shellMocks.backendImported).toHaveBeenCalledOnce();
        expect(shellMocks.removeBackend).toHaveBeenCalledExactlyOnceWith('webgpu');
        expect(shellMocks.registerBackend).toHaveBeenCalledTimes(2);
        expect(shellMocks.registerBackend).toHaveBeenLastCalledWith('webgpu', expect.any(Function), 3);
        const backendFactory = shellMocks.registerBackend.mock.calls[1]?.[1];
        if (typeof backendFactory !== 'function') {
            throw new TypeError('TF.js worker shell did not register a WebGPU backend factory');
        }
        expect(backendFactory()).toEqual(new shellMocks.WebGPUBackendMock(device, verifiedInfo));
        expect(shellMocks.backendImported.mock.invocationCallOrder[0]).toBeLessThan(
            shellMocks.removeBackend.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY
        );
        expect(shellMocks.removeBackend.mock.invocationCallOrder[0]).toBeLessThan(
            shellMocks.registerBackend.mock.invocationCallOrder[1] ?? Number.NEGATIVE_INFINITY
        );
        expect(shellMocks.setBackend).toHaveBeenCalledExactlyOnceWith('webgpu');
        expect(shellMocks.ready).toHaveBeenCalledOnce();
        expect(shellMocks.getBackend).toHaveBeenCalledOnce();
        expect(tf.getBackend()).toBe('webgpu');
        expect(shellMocks.environment.global).toBe(globalThis);
        expect(shellMocks.registerOp).toHaveBeenCalledWith('Roll', expect.any(Function));

        const input = new shellMocks.TensorMock(new Float32Array(2), [1, 1, 2]);
        const first = new shellMocks.TensorMock(new Float32Array(1), [1, 1, 1]);
        const second = new shellMocks.TensorMock(new Float32Array(1), [1, 1, 1]);
        const rolled = new shellMocks.TensorMock(new Float32Array(2), [1, 1, 2]);
        shellMocks.split.mockReturnValue([first, second]);
        shellMocks.concat.mockReturnValue(rolled);
        const roll = shellMocks.registerOp.mock.calls[0]?.[1];
        if (typeof roll !== 'function') {
            throw new TypeError('TF.js worker shell did not register Roll');
        }

        expect(roll({ inputs: [input] })).toBe(rolled);
        expect(shellMocks.split).toHaveBeenCalledExactlyOnceWith(input, 2, 2);
        expect(shellMocks.concat).toHaveBeenCalledExactlyOnceWith([second, first], 2);
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(second.dispose).toHaveBeenCalledOnce();
    });

    it('reports verified device loss exactly once and disposes the runtime', async () => {
        const deviceLost = deferred<GPUDeviceLostInfo>();
        const device = { lost: deviceLost.promise } as GPUDevice;
        shellMocks.requireHardwareWebGpu.mockResolvedValueOnce({
            adapter: { info: { isFallbackAdapter: false } } as GPUAdapter,
            device,
        });
        installNavigatorGpu({});
        await importShell();
        await requireCapturedInput().initializeTfjs();

        deviceLost.resolve({ reason: 'unknown', message: 'GPU process reset' } as GPUDeviceLostInfo);
        await vi.waitFor(() => expect(runtime.dispose).toHaveBeenCalledOnce());
        requireWorkerHandler('onmessageerror')(new MessageEvent('messageerror'));

        expect(postMessage).toHaveBeenCalledExactlyOnceWith(
            { type: 'worker-fatal-error', error: 'TF.js WebGPU device lost (unknown): GPU process reset' },
            undefined
        );
        expect(runtime.dispose).toHaveBeenCalledOnce();
    });

    it('adapts GraphModel loading and maps only wrapped tensor feeds back through the WeakMap', async () => {
        installNavigatorGpu({});
        await importShell();
        const tf = await requireCapturedInput().initializeTfjs();
        const rawPitch = new shellMocks.TensorMock(Int32Array.from([220, 221]), [2]);
        const rawLoudness = new shellMocks.TensorMock(Float32Array.from([-60, -59]), [2]);
        const rawOutput = new shellMocks.TensorMock(Float32Array.from([0.1, -0.1]), [1, 2]);
        const rawModel = { dispose: vi.fn(), predict: vi.fn(() => rawOutput) };
        shellMocks.tensor1d.mockReturnValueOnce(rawPitch).mockReturnValueOnce(rawLoudness);
        shellMocks.loadGraphModel.mockResolvedValue(rawModel);
        const handler = {
            load: vi.fn(async () => ({ modelTopology: {}, weightData: new ArrayBuffer(0), weightSpecs: [] })),
        };

        const model = await tf.loadGraphModel(handler);
        const pitch = tf.tensor1d(Float32Array.from([220, 221]));
        const loudness = tf.tensor1d(Float32Array.from([-60, -59]));
        const prediction = requireWorkerTensor(model.predict({ f0_hz: pitch, loudness_db: loudness }));

        expect(shellMocks.loadGraphModel).toHaveBeenCalledExactlyOnceWith(handler);
        expect(rawModel.predict).toHaveBeenCalledExactlyOnceWith({ f0_hz: rawPitch, loudness_db: rawLoudness });
        await expect(pitch.data()).resolves.toEqual(Float32Array.from([220, 221]));
        await expect(prediction.data()).resolves.toEqual(Float32Array.from([0.1, -0.1]));
        expect(pitch).toMatchObject({ dtype: 'float32', shape: [2] });
        expect(() =>
            model.predict({
                unknown: {
                    data: async () => new Float32Array(),
                    dispose: () => undefined,
                    dtype: 'float32',
                    shape: [0],
                },
            })
        ).toThrow('unknown TF.js tensor');

        pitch.dispose();
        loudness.dispose();
        prediction.dispose();
        model.dispose();
        expect(rawPitch.dispose).toHaveBeenCalledOnce();
        expect(rawLoudness.dispose).toHaveBeenCalledOnce();
        expect(rawOutput.dispose).toHaveBeenCalledOnce();
        expect(rawModel.dispose).toHaveBeenCalledOnce();
    });
});
