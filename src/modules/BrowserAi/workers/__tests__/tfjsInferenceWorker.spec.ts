import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';

type RuntimeModule = typeof import('../tfjsInferenceWorkerRuntime');
type HandlerInput = Parameters<RuntimeModule['createTfjsInferenceRequestHandler']>[0];
type Runtime = ReturnType<RuntimeModule['createTfjsInferenceRequestHandler']>;

const shellMocks = vi.hoisted(() => ({
    createHandler: vi.fn<RuntimeModule['createTfjsInferenceRequestHandler']>(),
    requireHardwareWebGpu: vi.fn<RuntimeModule['requireHardwareWebGpu']>(),
}));

vi.mock('../tfjsInferenceWorkerRuntime', () => ({
    createTfjsInferenceRequestHandler: shellMocks.createHandler,
    requireHardwareWebGpu: shellMocks.requireHardwareWebGpu,
}));

const originalPostMessage = self.postMessage;
let capturedInput: HandlerInput | undefined;
let runtime: Runtime;
let postMessage: ReturnType<typeof vi.fn>;

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
        shellMocks.requireHardwareWebGpu.mockResolvedValue(undefined);
    });

    afterEach(() => {
        Object.defineProperty(self, 'postMessage', {
            configurable: true,
            value: originalPostMessage,
            writable: true,
        });
        Reflect.set(self, 'onmessage', null);
        Reflect.set(self, 'onmessageerror', null);
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

    it('disposes the runtime when self.onmessageerror fires', async () => {
        await importShell();

        requireWorkerHandler('onmessageerror')(new MessageEvent('messageerror'));

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
});
