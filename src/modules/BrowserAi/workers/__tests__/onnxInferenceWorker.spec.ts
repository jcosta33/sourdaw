import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
