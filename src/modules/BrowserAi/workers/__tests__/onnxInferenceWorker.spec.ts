import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';

const createSession = vi.hoisted(() => vi.fn());

vi.mock('onnxruntime-web', () => ({
    InferenceSession: { create: createSession },
    Tensor: class {},
    env: { wasm: { numThreads: 1 }, logLevel: 'error' },
}));

type WorkerMessageHandler = (event: MessageEvent<WorkerRequest>) => Promise<void>;

function installNavigator(value: object): void {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

describe('onnxInferenceWorker session provider reporting', () => {
    beforeEach(async () => {
        vi.resetModules();
        createSession.mockReset().mockResolvedValue({ run: vi.fn(), release: vi.fn() });
        installNavigator({});
        Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
        self.postMessage = vi.fn();
        await import('../onnxInferenceWorker');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports the fallback provider and preserves it when the cached session is reused', async () => {
        const onmessage = self.onmessage as WorkerMessageHandler;
        const first: WorkerRequest = {
            type: 'create-session',
            requestId: 'first',
            modelId: 'model-1',
            modelData: new ArrayBuffer(8),
            options: {},
        };
        await onmessage({ data: first } as MessageEvent<WorkerRequest>);

        installNavigator({ gpu: {} });
        const second: WorkerRequest = { ...first, requestId: 'second', modelData: new ArrayBuffer(8) };
        await onmessage({ data: second } as MessageEvent<WorkerRequest>);

        expect(createSession).toHaveBeenCalledExactlyOnceWith(first.modelData, { executionProviders: ['wasm'] });
        expect(self.postMessage).toHaveBeenNthCalledWith(1, {
            type: 'session-created',
            requestId: 'first',
            modelId: 'model-1',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenNthCalledWith(2, {
            type: 'session-created',
            requestId: 'second',
            modelId: 'model-1',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
    });

    it('receives model bytes from the storage-worker port without a renderer buffer request', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const modelData = new ArrayBuffer(12);
        const channel = new MessageChannel();
        channel.port2.postMessage({ type: 'model-data', modelData }, [modelData]);
        const request: WorkerRequest = {
            type: 'create-session-from-model-port',
            requestId: 'from-storage',
            modelId: 'model-from-storage',
            modelDataPort: channel.port1,
            options: {},
        };

        await (self.onmessage as WorkerMessageHandler)({ data: request } as MessageEvent<WorkerRequest>);

        const receivedModelData = createSession.mock.calls[0]?.[0] as ArrayBuffer | undefined;
        expect(receivedModelData?.byteLength).toBe(12);
        expect(createSession.mock.calls[0]?.[1]).toEqual({ executionProviders: ['wasm'] });
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'from-storage',
            modelId: 'model-from-storage',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes the storage-worker port when it receives a model error', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const channel = new MessageChannel();
        channel.port2.postMessage({ type: 'model-error', name: 'Error', message: 'opfs failed' });
        const request: WorkerRequest = {
            type: 'create-session-from-model-port',
            requestId: 'storage-error',
            modelId: 'model-from-storage',
            modelDataPort: channel.port1,
            options: {},
        };

        await (self.onmessage as WorkerMessageHandler)({ data: request } as MessageEvent<WorkerRequest>);

        expect(createSession).not.toHaveBeenCalled();
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'storage-error',
            error: 'Error: Error: opfs failed',
        } satisfies WorkerResponse);
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes the storage-worker port when model data cannot be decoded', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const channel = new MessageChannel();
        const request: WorkerRequest = {
            type: 'create-session-from-model-port',
            requestId: 'storage-message-error',
            modelId: 'model-from-storage',
            modelDataPort: channel.port1,
            options: {},
        };

        const response = (self.onmessage as WorkerMessageHandler)({
            data: request,
        } as MessageEvent<WorkerRequest>);
        channel.port1.onmessageerror?.({} as MessageEvent);
        await response;

        expect(createSession).not.toHaveBeenCalled();
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'storage-message-error',
            error: 'Error: Model storage worker returned unreadable model data',
        } satisfies WorkerResponse);
        expect(close).toHaveBeenCalledOnce();
    });

    it('reports only the provider whose single-provider session creation succeeded', async () => {
        vi.resetModules();
        installNavigator({ gpu: {} });
        createSession
            .mockReset()
            .mockImplementation((_modelData: ArrayBuffer, options?: { executionProviders?: string[] }) => {
                if (options?.executionProviders?.includes('webgpu')) {
                    return Promise.reject(new Error('webgpu backend unavailable'));
                }
                return Promise.resolve({ run: vi.fn(), release: vi.fn() });
            });
        self.postMessage = vi.fn();
        await import('../onnxInferenceWorker');

        const request: WorkerRequest = {
            type: 'create-session',
            requestId: 'fallback',
            modelId: 'model-fallback',
            modelData: new ArrayBuffer(8),
            options: {},
        };
        await (self.onmessage as WorkerMessageHandler)({ data: request } as MessageEvent<WorkerRequest>);

        expect(createSession).toHaveBeenNthCalledWith(1, request.modelData, { executionProviders: ['webgpu'] });
        expect(createSession).toHaveBeenNthCalledWith(2, request.modelData, { executionProviders: ['wasm'] });
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'fallback',
            modelId: 'model-fallback',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
    });
});

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let deferredResolve!: (value: T) => void;
    let deferredReject!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        deferredResolve = resolve;
        deferredReject = reject;
    });
    return { promise, resolve: deferredResolve, reject: deferredReject };
}

describe('onnxInferenceWorker session coalescing and cancellation', () => {
    beforeEach(async () => {
        vi.resetModules();
        createSession.mockReset().mockResolvedValue({ run: vi.fn(), release: vi.fn() });
        installNavigator({});
        Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
        self.postMessage = vi.fn();
        await import('../onnxInferenceWorker');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('coalesces concurrent cold create-session calls for the same modelId', async () => {
        const deferred = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementation(() => deferred.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-1',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        const p2 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-2',
                modelId: 'model-1',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        deferred.resolve({ run: vi.fn(), release: mockRelease });
        await Promise.all([p1, p2]);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-1',
            modelId: 'model-1',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2',
            modelId: 'model-1',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: ['model-1'],
            memoryUsageBytes: 8,
        } satisfies WorkerResponse);
    });

    it('coalesces concurrent cold create-session and create-session-from-model-port for the same modelId', async () => {
        const deferred = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        createSession.mockImplementation(() => deferred.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-shared',
                modelData: new ArrayBuffer(16),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        const channel = new MessageChannel();
        const modelData = new ArrayBuffer(16);
        channel.port2.postMessage({ type: 'model-data', modelData }, [modelData]);

        const p2 = onmessage({
            data: {
                type: 'create-session-from-model-port',
                requestId: 'req-2',
                modelId: 'model-shared',
                modelDataPort: channel.port1,
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        deferred.resolve({ run: vi.fn(), release: vi.fn().mockResolvedValue(undefined) });
        await Promise.all([p1, p2]);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-1',
            modelId: 'model-shared',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2',
            modelId: 'model-shared',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
    });

    it('clears in-flight reservation when session creation fails so subsequent requests can retry', async () => {
        const deferred1 = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        createSession.mockImplementationOnce(() => deferred1.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'fail-1',
                modelId: 'model-fail',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        const p2 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'fail-2',
                modelId: 'model-fail',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        deferred1.reject(new Error('Corrupt model data'));
        await Promise.all([p1, p2]);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'fail-1',
            error: expect.stringContaining('Corrupt model data'),
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'fail-2',
            error: expect.stringContaining('Corrupt model data'),
        } satisfies WorkerResponse);

        createSession.mockResolvedValueOnce({ run: vi.fn(), release: vi.fn().mockResolvedValue(undefined) });
        await onmessage({
            data: {
                type: 'create-session',
                requestId: 'retry-3',
                modelId: 'model-fail',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        expect(createSession).toHaveBeenCalledTimes(2);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'retry-3',
            modelId: 'model-fail',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
    });

    it('does not resurrect session when release occurs during in-flight creation', async () => {
        const deferred = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementation(() => deferred.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const createPromise = onmessage({
            data: {
                type: 'create-session',
                requestId: 'create-req',
                modelId: 'model-release-in-flight',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        const releasePromise = onmessage({
            data: {
                type: 'release-session',
                modelId: 'model-release-in-flight',
            },
        } as MessageEvent<WorkerRequest>);

        deferred.resolve({ run: vi.fn(), release: mockRelease });
        await Promise.all([createPromise, releasePromise]);

        await vi.waitFor(() => expect(mockRelease).toHaveBeenCalledOnce());

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: [],
            memoryUsageBytes: 0,
        } satisfies WorkerResponse);
    });

    it('aborts in-flight creation and releases session when all subscribers cancel', async () => {
        const deferred = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementation(() => deferred.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const createPromise = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-cancel-all',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        await onmessage({
            data: {
                type: 'cancel-request',
                requestId: 'req-1',
            },
        } as MessageEvent<WorkerRequest>);

        deferred.resolve({ run: vi.fn(), release: mockRelease });
        await createPromise;

        await vi.waitFor(() => expect(mockRelease).toHaveBeenCalledOnce());

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: [],
            memoryUsageBytes: 0,
        } satisfies WorkerResponse);
    });

    it('preserves session for remaining subscriber when one subscriber cancels', async () => {
        const deferred = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementation(() => deferred.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-multi-sub',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        const p2 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-2',
                modelId: 'model-multi-sub',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

        await onmessage({
            data: {
                type: 'cancel-request',
                requestId: 'req-1',
            },
        } as MessageEvent<WorkerRequest>);

        deferred.resolve({ run: vi.fn(), release: mockRelease });
        await Promise.all([p1, p2]);

        expect(mockRelease).not.toHaveBeenCalled();
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'req-1',
            error: expect.stringContaining('Session creation was cancelled'),
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2',
            modelId: 'model-multi-sub',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: ['model-multi-sub'],
            memoryUsageBytes: 8,
        } satisfies WorkerResponse);
    });

    it('creates a fresh session when a new request arrives after all previous subscribers were cancelled', async () => {
        const deferred1 = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const deferred2 = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease1 = vi.fn().mockResolvedValue(undefined);
        const mockRelease2 = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementationOnce(() => deferred1.promise).mockImplementationOnce(() => deferred2.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;

        // 1. Start create-session for req-1 (model-resub)
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-resub',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

        // 2. Send cancel-request for req-1
        await onmessage({
            data: {
                type: 'cancel-request',
                requestId: 'req-1',
            },
        } as MessageEvent<WorkerRequest>);

        // 3. While createSession is still pending, send a new create-session for req-2 (model-resub)
        const p2 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-2',
                modelId: 'model-resub',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

        // 4. Resolve createSession
        deferred1.resolve({ run: vi.fn(), release: mockRelease1 });
        deferred2.resolve({ run: vi.fn(), release: mockRelease2 });
        await Promise.all([p1, p2]);

        // 5. Verify req-1 received cancellation error, req-2 received session-created, and model-resub is cached
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'error',
            requestId: 'req-1',
            error: expect.stringContaining('Session creation was cancelled'),
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2',
            modelId: 'model-resub',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: ['model-resub'],
            memoryUsageBytes: 8,
        } satisfies WorkerResponse);
    });

    it('does not evict replacement load when earlier aborted load completes', async () => {
        const deferred1 = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const deferred2 = createDeferred<{ run: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }>();
        const mockRelease1 = vi.fn().mockResolvedValue(undefined);
        const mockRelease2 = vi.fn().mockResolvedValue(undefined);
        createSession.mockImplementationOnce(() => deferred1.promise).mockImplementationOnce(() => deferred2.promise);

        const onmessage = self.onmessage as WorkerMessageHandler;

        // 1. Start load 1 for model-replace
        const p1 = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-1',
                modelId: 'model-replace',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

        // 2. Send release-session for model-replace (aborts load 1 and clears map)
        const pRelease = onmessage({
            data: {
                type: 'release-session',
                modelId: 'model-replace',
            },
        } as MessageEvent<WorkerRequest>);

        // 3. Start load 2 for model-replace with req-2a
        const p2a = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-2a',
                modelId: 'model-replace',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

        // 4. Start load 2 companion request with req-2b
        const p2b = onmessage({
            data: {
                type: 'create-session',
                requestId: 'req-2b',
                modelId: 'model-replace',
                modelData: new ArrayBuffer(8),
                options: {},
            },
        } as MessageEvent<WorkerRequest>);

        // 5. Resolve load 1 (finishes its finally block)
        deferred1.resolve({ run: vi.fn(), release: mockRelease1 });
        await Promise.all([p1, pRelease]);

        // 6. Verify load 2 is STILL present in sessionLoads so req-2b coalesced onto load 2
        expect(createSession).toHaveBeenCalledTimes(2);

        // 7. Resolve load 2. Verify both req-2a and req-2b succeed
        deferred2.resolve({ run: vi.fn(), release: mockRelease2 });
        await Promise.all([p2a, p2b]);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2a',
            modelId: 'model-replace',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);
        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'session-created',
            requestId: 'req-2b',
            modelId: 'model-replace',
            executionProviders: ['wasm'],
        } satisfies WorkerResponse);

        await onmessage({
            data: {
                type: 'get-status',
                requestId: 'status-req',
            },
        } as MessageEvent<WorkerRequest>);

        expect(self.postMessage).toHaveBeenCalledWith({
            type: 'status',
            requestId: 'status-req',
            loadedModels: ['model-replace'],
            memoryUsageBytes: 8,
        } satisfies WorkerResponse);
    });
});
