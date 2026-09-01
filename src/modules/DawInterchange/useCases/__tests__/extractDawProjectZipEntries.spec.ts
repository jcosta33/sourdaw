import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractDawProjectZipEntries } from '../extractDawProjectZipEntries';
import { readDawProjectZip } from '../readDawProjectZip';
import { type DawProjectZipWorkerRequest, type DawProjectZipWorkerResponse } from '../runDawProjectZipWorkerRequest';

/**
 * Mirrors `extractSingleGuardedZipEntry.spec.ts` in `#/infra/archive`: proves
 * the Worker lifecycle (transfer, terminate, abort, error propagation)
 * without depending on a real Worker implementation in the test environment.
 *
 * `postMessage` actually performs the structured-clone transfer via
 * `structuredClone(message, { transfer })` (Node 17+, available under
 * Vitest) instead of being a bare spy. A real `Worker.postMessage` detaches
 * every buffer named in `transfer`; a spy that never transfers cannot catch
 * a caller that reuses an already-detached buffer across two calls (issue
 * #3317's DataCloneError on `readAudioAssets`), because the archive bytes
 * stay attached and readable no matter how many times they are "posted".
 */
class ControlledWorker {
    static instances: ControlledWorker[] = [];
    static postMessageError: Error | undefined;
    onmessage: ((event: MessageEvent<DawProjectZipWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn<(message: DawProjectZipWorkerRequest, transfer: Transferable[]) => void>(
        (message, transfer) => {
            if (ControlledWorker.postMessageError) {
                throw ControlledWorker.postMessageError;
            }
            structuredClone(message, { transfer });
        }
    );
    terminate = vi.fn();

    constructor() {
        ControlledWorker.instances.push(this);
    }

    respond(response: DawProjectZipWorkerResponse): void {
        this.onmessage?.({ data: response } as MessageEvent<DawProjectZipWorkerResponse>);
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

describe('extractDawProjectZipEntries', () => {
    it('transfers bytes and the phase/limits to the worker and terminates after success', async () => {
        const input = new Uint8Array([1, 2, 3]);
        const promise = extractDawProjectZipEntries({
            bytes: input,
            phase: 'header',
            restrictLimits: { maxArchiveBytes: 64 },
        });
        const worker = ControlledWorker.instances[0];
        const output = new Uint8Array([7, 8]);

        worker?.respond({ type: 'success', entries: { 'project.xml': output.buffer } });

        await expect(promise).resolves.toEqual({ entries: { 'project.xml': output } });
        const [request, transfer] = worker?.postMessage.mock.calls[0] ?? [];
        expect(request?.phase).toBe('header');
        expect(request?.restrictLimits).toEqual({ maxArchiveBytes: 64 });
        expect(request?.bytes).toBeInstanceOf(ArrayBuffer);
        expect(transfer).toEqual([request?.bytes]);
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });

    it('terminates and rejects worker-reported archive errors', async () => {
        const promise = extractDawProjectZipEntries({
            bytes: new Uint8Array([1]),
            phase: 'header',
            restrictLimits: {},
        });
        const worker = ControlledWorker.instances[0];

        worker?.respond({ type: 'error', message: 'DAWproject archive is missing project.xml at its root' });

        await expect(promise).rejects.toThrow(/missing project\.xml/i);
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });

    it('terminates when transferring the request to the worker fails', async () => {
        ControlledWorker.postMessageError = new Error('transfer failed');

        const promise = extractDawProjectZipEntries({ bytes: new Uint8Array([1]), phase: 'audio', restrictLimits: {} });

        await expect(promise).rejects.toThrow('transfer failed');
        expect(ControlledWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    });

    it('rejects an already-aborted request without creating a worker', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            extractDawProjectZipEntries({
                bytes: new Uint8Array([1]),
                phase: 'header',
                restrictLimits: {},
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(ControlledWorker.instances).toEqual([]);
    });

    it('terminates an in-flight worker on abort and ignores a late response', async () => {
        const controller = new AbortController();
        const promise = extractDawProjectZipEntries({
            bytes: new Uint8Array([1]),
            phase: 'header',
            restrictLimits: {},
            signal: controller.signal,
        });
        const worker = ControlledWorker.instances[0];

        controller.abort();
        worker?.respond({ type: 'success', entries: { 'project.xml': new Uint8Array([9]).buffer } });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(worker?.terminate).toHaveBeenCalledOnce();
    });
});

describe('readDawProjectZip — through a transferring fake worker (regression for issue #3317)', () => {
    it('completes both the header phase and readAudioAssets without detaching a reused buffer', async () => {
        const buffer = new ArrayBuffer(8);
        new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6, 7, 8]);

        const resultPromise = readDawProjectZip(buffer);
        const headerWorker = ControlledWorker.instances[0];
        headerWorker?.respond({
            type: 'success',
            entries: { 'project.xml': new TextEncoder().encode('<Project/>').buffer },
        });
        const result = await resultPromise;
        expect(result.projectXml).toBe('<Project/>');

        const audioPromise = result.readAudioAssets();
        const audioWorker = ControlledWorker.instances[1];
        audioWorker?.respond({
            type: 'success',
            entries: { 'audio/kick.wav': new TextEncoder().encode('kick').buffer },
        });
        const audioAssets = await audioPromise;

        expect(audioAssets.has('audio/kick.wav')).toBe(true);
        expect(headerWorker?.postMessage).toHaveBeenCalledOnce();
        expect(audioWorker?.postMessage).toHaveBeenCalledOnce();
    });
});
