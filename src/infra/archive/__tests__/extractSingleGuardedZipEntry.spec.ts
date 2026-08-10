import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractSingleGuardedZipEntry } from '../extractSingleGuardedZipEntry';
import { type GuardedZipWorkerRequest, type GuardedZipWorkerResponse } from '../runGuardedZipWorkerRequest';

class ControlledWorker {
    static instances: ControlledWorker[] = [];
    static postMessageError: Error | undefined;
    onmessage: ((event: MessageEvent<GuardedZipWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn<(message: GuardedZipWorkerRequest, transfer: Transferable[]) => void>(() => {
        if (ControlledWorker.postMessageError) {
            throw ControlledWorker.postMessageError;
        }
    });
    terminate = vi.fn();

    constructor() {
        ControlledWorker.instances.push(this);
    }

    respond(response: GuardedZipWorkerResponse): void {
        this.onmessage?.({ data: response } as MessageEvent<GuardedZipWorkerResponse>);
    }
}

beforeEach(() => {
    ControlledWorker.instances = [];
    ControlledWorker.postMessageError = undefined;
    vi.stubGlobal('Worker', ControlledWorker);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('extractSingleGuardedZipEntry', () => {
    it('transfers bytes to the worker and terminates after success', async () => {
        const input = new Uint8Array([1, 2, 3]);
        const promise = extractSingleGuardedZipEntry({ bytes: input, suffix: '.onnx' });
        const worker = ControlledWorker.instances[0];
        const output = new Uint8Array([7, 8]);

        worker?.respond({ type: 'success', path: 'model.onnx', data: output.buffer });

        await expect(promise).resolves.toEqual({ path: 'model.onnx', data: output });
        const [request, transfer] = worker?.postMessage.mock.calls[0] ?? [];
        expect(request?.suffix).toBe('.onnx');
        expect(request?.bytes).toBeInstanceOf(ArrayBuffer);
        expect(transfer).toEqual([request?.bytes]);
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });

    it('terminates and rejects worker-reported archive errors', async () => {
        const promise = extractSingleGuardedZipEntry({ bytes: new Uint8Array([1]), suffix: '.onnx' });
        const worker = ControlledWorker.instances[0];

        worker?.respond({ type: 'error', message: 'Unsafe archive path' });

        await expect(promise).rejects.toThrow('Unsafe archive path');
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });

    it('terminates when transferring the request to the worker fails', async () => {
        ControlledWorker.postMessageError = new Error('transfer failed');

        const promise = extractSingleGuardedZipEntry({ bytes: new Uint8Array([1]), suffix: '.onnx' });

        await expect(promise).rejects.toThrow('transfer failed');
        expect(ControlledWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    });

    it('rejects an already-aborted request without creating a worker', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            extractSingleGuardedZipEntry({ bytes: new Uint8Array([1]), suffix: '.onnx', signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(ControlledWorker.instances).toEqual([]);
    });

    it('terminates an in-flight worker on abort and ignores a late response', async () => {
        const controller = new AbortController();
        const promise = extractSingleGuardedZipEntry({
            bytes: new Uint8Array([1]),
            suffix: '.onnx',
            signal: controller.signal,
        });
        const worker = ControlledWorker.instances[0];

        controller.abort();
        worker?.respond({ type: 'success', path: 'late.onnx', data: new Uint8Array([9]).buffer });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });
});
