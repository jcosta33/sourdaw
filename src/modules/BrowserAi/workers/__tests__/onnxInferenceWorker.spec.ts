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
