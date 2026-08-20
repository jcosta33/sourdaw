import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type ModelStorageWorkerRequest,
    type ModelStorageWorkerResponse,
} from '../../models/ModelStorageWorkerProtocol';
import { modelStorageWorkerBridge } from '../modelStorageWorkerBridge';

class FakeWorker {
    static instances: FakeWorker[] = [];
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessage: ((event: MessageEvent<ModelStorageWorkerResponse>) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() {
        FakeWorker.instances.push(this);
    }

    reply(response: ModelStorageWorkerResponse): void {
        this.onmessage?.({ data: response } as MessageEvent<ModelStorageWorkerResponse>);
    }
}

function worker(): FakeWorker {
    const instance = FakeWorker.instances[0];
    if (!instance) {
        throw new Error('Expected model storage worker');
    }
    return instance;
}

function lastRequest(): ModelStorageWorkerRequest {
    const request = worker().postMessage.mock.calls.at(-1)?.[0] as ModelStorageWorkerRequest | undefined;
    if (!request) {
        throw new Error('Expected model storage request');
    }
    return request;
}

describe('modelStorageWorkerBridge', () => {
    beforeEach(() => {
        modelStorageWorkerBridge.terminate();
        FakeWorker.instances = [];
        vi.stubGlobal('Worker', FakeWorker);
    });

    afterEach(() => {
        modelStorageWorkerBridge.terminate();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns a destination port while transferring its peer to the storage worker', async () => {
        const promise = modelStorageWorkerBridge.readModel({
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 86,
            expectedSha256: 'verified',
        });
        const request = lastRequest();
        if (request.type !== 'read-model') {
            throw new Error(`Unexpected request: ${request.type}`);
        }
        expect(worker().postMessage.mock.calls[0]?.[1]).toEqual([request.destinationPort]);

        worker().reply({ type: 'read-complete', requestId: request.requestId, found: true });

        const destinationPort = await promise;
        expect(destinationPort).toBeInstanceOf(MessagePort);
        expect(destinationPort).not.toBe(request.destinationPort);
    });

    it('closes the receiving channel port when the model is not found', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const promise = modelStorageWorkerBridge.readModel({ family: 'kokoro', modelId: 'missing.onnx' });
        const request = lastRequest();

        worker().reply({ type: 'read-complete', requestId: request.requestId, found: false });

        await expect(promise).resolves.toBeNull();
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes the receiving channel port when the storage worker rejects the read', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const promise = modelStorageWorkerBridge.readModel({ family: 'kokoro', modelId: 'broken.onnx' });
        const request = lastRequest();

        worker().reply({ type: 'error', requestId: request.requestId, name: 'Error', message: 'opfs failed' });

        await expect(promise).rejects.toThrow('opfs failed');
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes the receiving channel port when the storage worker response is unreadable', async () => {
        const close = vi.spyOn(MessagePort.prototype, 'close');
        const promise = modelStorageWorkerBridge.readModel({ family: 'kokoro', modelId: 'unreadable.onnx' });

        worker().onmessageerror?.({} as MessageEvent);

        await expect(promise).rejects.toThrow('Model storage worker returned an unreadable response');
        expect(close).toHaveBeenCalledOnce();
    });

    it('transfers bulk download bytes instead of serializing them into the worker request', async () => {
        const chunk = Uint8Array.from([2, 3, 5, 7]).buffer;
        const promise = modelStorageWorkerBridge.writeModelChunk({ writeId: 'write-1', chunk });
        const request = lastRequest();
        if (request.type !== 'write-model-chunk') {
            throw new Error(`Unexpected request: ${request.type}`);
        }
        expect(request.chunk).toBe(chunk);
        expect(worker().postMessage.mock.calls[0]?.[1]).toEqual([chunk]);

        worker().reply({
            type: 'chunk-written',
            requestId: request.requestId,
            bytesWritten: chunk.byteLength,
        });

        await expect(promise).resolves.toBe(chunk.byteLength);
    });

    it('keeps verification progress on the explicit commit request', async () => {
        const onProgress = vi.fn();
        const promise = modelStorageWorkerBridge.commitModelWrite({ writeId: 'write-1', onProgress });
        const request = lastRequest();
        if (request.type !== 'commit-model-write') {
            throw new Error(`Unexpected request: ${request.type}`);
        }
        worker().reply({ type: 'write-progress', requestId: request.requestId, stage: 'verifying' });
        worker().reply({
            type: 'write-committed',
            requestId: request.requestId,
            storedBytes: 86,
            extractedPath: null,
        });

        expect(onProgress).toHaveBeenCalledWith('verifying');
        await expect(promise).resolves.toEqual({ storedBytes: 86, extractedPath: null });
    });
});
