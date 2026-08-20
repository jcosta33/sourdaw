import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZipArchiveError } from '#/infra/archive/extractGuardedZip';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type ModelDownloadProgressPayload } from '../../models/ModelDownloadProgress';
import { type ModelStorageWriteStage } from '../../models/ModelStorageWorkerProtocol';
import { downloadModel } from '../modelDownloadManager';
import { type ModelStoragePort } from '../modelStorageWorkerBridge';

type Deferred<T> = {
    promise: Promise<T>;
    reject: (reason: unknown) => void;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    let rejectPromise: ((reason: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve(value) {
            resolvePromise?.(value);
        },
        reject(reason) {
            rejectPromise?.(reason);
        },
    };
}

function streamingResponse(chunks: Uint8Array[], totalBytes: number, cancel = vi.fn()): Response {
    let index = 0;
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name === 'content-length' ? String(totalBytes) : null) },
        body: {
            getReader() {
                return {
                    cancel,
                    read(): Promise<{ done: boolean; value?: Uint8Array }> {
                        if (index < chunks.length) {
                            const value = chunks[index];
                            index += 1;
                            return Promise.resolve({ done: false, value });
                        }
                        return Promise.resolve({ done: true });
                    },
                };
            },
        },
    } as unknown as Response;
}

let channelConstructions = 0;
let openChannels = 0;

class FakeBroadcastChannel {
    constructor(public name: string) {
        channelConstructions += 1;
        openChannels += 1;
    }
    postMessage(): void {}
    close(): void {
        openChannels -= 1;
    }
}

const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), setWriters: vi.fn(), warn: vi.fn() };
const deleteModel = vi.fn<(input: { family: string; modelId: string }) => Promise<void>>();
const getStorageStatus = vi.fn(() =>
    Promise.resolve({ usedBytes: 0, limitBytes: 2 * 1024 * 1024 * 1024, persisted: true, availableBytes: 1e12 })
);
const requestPersistentStorage = vi.fn(() => Promise.resolve(true));
const beginModelWrite = vi.fn<ModelStoragePort['beginModelWrite']>();
const writeModelChunk = vi.fn<ModelStoragePort['writeModelChunk']>();
const commitModelWrite = vi.fn<ModelStoragePort['commitModelWrite']>();
const abortModelWrite = vi.fn<ModelStoragePort['abortModelWrite']>();

const modelStorageWorkerBridge: ModelStoragePort = {
    abortModelWrite,
    beginModelWrite,
    checkModel: vi.fn(),
    commitModelWrite,
    deleteModel: vi.fn(),
    measureStorage: vi.fn(),
    readModel: vi.fn(),
    verifyModel: vi.fn(),
    writeModelChunk,
};

const baseSpec = {
    modelId: 'violin-1',
    family: 'ddsp',
    url: 'https://cdn.example/violin-1.onnx',
    sizeBytes: 30,
};

beforeEach(() => {
    channelConstructions = 0;
    openChannels = 0;
    vi.clearAllMocks();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    beginModelWrite.mockResolvedValue('write-1');
    writeModelChunk.mockImplementation(({ chunk }) => Promise.resolve(chunk.byteLength));
    commitModelWrite.mockResolvedValue({ storedBytes: baseSpec.sizeBytes, extractedPath: null });
    abortModelWrite.mockResolvedValue(undefined);
    deleteModel.mockResolvedValue(undefined);
    getStorageStatus.mockResolvedValue({
        usedBytes: 0,
        limitBytes: 2 * 1024 * 1024 * 1024,
        persisted: true,
        availableBytes: 1e12,
    });
    requestPersistentStorage.mockResolvedValue(true);
    injectDependencies(downloadModel, {
        logger,
        deleteModel,
        getStorageStatus,
        modelStorageWorkerBridge,
        requestPersistentStorage,
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('downloadModel storage worker stream', () => {
    it('keeps one network chunk in flight and transfers every chunk to the worker', async () => {
        const firstWrite = deferred<number>();
        let writes = 0;
        writeModelChunk.mockImplementation(({ chunk }) => {
            writes += 1;
            return writes === 1 ? firstWrite.promise : Promise.resolve(chunk.byteLength);
        });
        const read = vi.fn();
        const response = streamingResponse([new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)], 30);
        const originalReader = response.body?.getReader();
        if (!originalReader) {
            throw new Error('Expected a response reader');
        }
        read.mockImplementation(() => originalReader.read());
        Object.defineProperty(response.body, 'getReader', { value: () => ({ ...originalReader, read }) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(response))
        );

        const promise = downloadModel({ spec: baseSpec });
        await vi.waitFor(() => expect(writeModelChunk).toHaveBeenCalledTimes(1));
        expect(read).toHaveBeenCalledTimes(1);
        firstWrite.resolve(10);
        await promise;

        expect(writeModelChunk.mock.calls.map(([input]) => input.chunk.byteLength)).toEqual([10, 10, 10]);
        expect(beginModelWrite).toHaveBeenCalledWith({
            family: 'ddsp',
            modelId: 'violin-1',
            expectedSizeBytes: 30,
            expectedSha256: undefined,
            archive: false,
        });
        expect(commitModelWrite).toHaveBeenCalledOnce();
        expect(abortModelWrite).not.toHaveBeenCalled();
    });

    it('keeps one BroadcastChannel for progress and closes it after completion', async () => {
        const chunks = Array.from({ length: 50 }, () => new Uint8Array(4));
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse(chunks, 200)))
        );
        const downloadingEvents: number[] = [];

        await downloadModel({
            spec: { ...baseSpec, sizeBytes: 200 },
            onProgress: (payload: ModelDownloadProgressPayload) => {
                if (payload.stage === 'downloading') {
                    downloadingEvents.push(payload.progress);
                }
            },
        });

        expect(channelConstructions).toBe(1);
        expect(openChannels).toBe(0);
        expect(downloadingEvents.length).toBeLessThan(chunks.length);
    });

    it('passes the caller AbortSignal through to fetch', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)));
        vi.stubGlobal('fetch', fetchMock);

        await downloadModel({ spec: baseSpec, signal: controller.signal });

        expect(fetchMock).toHaveBeenCalledWith(baseSpec.url, { signal: controller.signal });
    });

    it('passes exact release verification and archive extraction to the storage worker', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.byteLength)))
        );
        commitModelWrite.mockImplementation(({ onProgress }) => {
            for (const stage of ['verifying', 'extracting', 'storing'] satisfies ModelStorageWriteStage[]) {
                onProgress?.(stage);
            }
            return Promise.resolve({ storedBytes: 64, extractedPath: 'package/model.onnx' });
        });
        const stages: string[] = [];

        await downloadModel({
            spec: {
                ...baseSpec,
                url: 'https://cdn.example/violin-1.ZIP?download=1#model',
                sizeBytes: bytes.byteLength,
                sha256: 'verified',
            },
            onProgress: (payload: ModelDownloadProgressPayload) => stages.push(payload.stage),
        });

        expect(beginModelWrite).toHaveBeenCalledWith({
            family: 'ddsp',
            modelId: 'violin-1',
            expectedSizeBytes: bytes.byteLength,
            expectedSha256: 'verified',
            archive: true,
        });
        expect(stages).toEqual(expect.arrayContaining(['verifying', 'extracting', 'storing', 'complete']));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('package/model.onnx'));
    });

    it('aborts every partial worker write when the exact byte count fails across retries', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(3)], 3)))
        );

        const promise = downloadModel({ spec: { ...baseSpec, sizeBytes: 4 } });
        const errorPromise = promise.catch((error: unknown) => error);
        await vi.runAllTimersAsync();

        expect(String(await errorPromise)).toContain('Size check failed');
        expect(beginModelWrite).toHaveBeenCalledTimes(3);
        expect(abortModelWrite).toHaveBeenCalledTimes(3);
        expect(commitModelWrite).not.toHaveBeenCalled();
    });

    it('aborts every partial worker write when an OPFS chunk write fails', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        writeModelChunk.mockRejectedValue(new Error('write failed'));

        const errorPromise = downloadModel({ spec: baseSpec }).catch((error: unknown) => error);
        await vi.runAllTimersAsync();

        expect(String(await errorPromise)).toContain('write failed');
        expect(beginModelWrite).toHaveBeenCalledTimes(3);
        expect(abortModelWrite).toHaveBeenCalledTimes(3);
        expect(commitModelWrite).not.toHaveBeenCalled();
    });

    it('retries transient commit failures and emits one terminal error', async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        commitModelWrite.mockRejectedValue(new Error('integrity failed'));
        const errors: ModelDownloadProgressPayload[] = [];

        const promise = downloadModel({
            spec: baseSpec,
            onProgress: (payload: ModelDownloadProgressPayload) => {
                if (payload.stage === 'error') {
                    errors.push(payload);
                }
            },
        });
        const errorPromise = promise.catch((error: unknown) => error);
        await vi.runAllTimersAsync();

        expect(String(await errorPromise)).toContain('Failed to download');
        expect(commitModelWrite).toHaveBeenCalledTimes(3);
        expect(abortModelWrite).toHaveBeenCalledTimes(3);
        expect(errors).toHaveLength(1);
    });

    it('requests persistent storage and warns when the owned cache is over quota', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        getStorageStatus.mockResolvedValue({
            usedBytes: 11,
            limitBytes: 10,
            persisted: false,
            availableBytes: 100,
        });

        await downloadModel({ spec: baseSpec });

        expect(requestPersistentStorage).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith('[ModelDownload] Storage limit exceeded — LRU eviction needed');
    });
});

describe('downloadModel cancellation and cleanup', () => {
    it('interrupts retry backoff without publishing an error stage', async () => {
        const controller = new AbortController();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new Error('network down')))
        );
        const stages: string[] = [];
        const promise = downloadModel({
            spec: baseSpec,
            signal: controller.signal,
            onProgress: (payload: ModelDownloadProgressPayload) => stages.push(payload.stage),
        });

        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('network down')));
        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(stages).not.toContain('error');
        expect(openChannels).toBe(0);
    });

    it('aborts an in-flight worker write and publishes no completed model', async () => {
        const controller = new AbortController();
        const pendingWrite = deferred<number>();
        writeModelChunk.mockReturnValue(pendingWrite.promise);
        abortModelWrite.mockImplementation(() => {
            pendingWrite.reject(new DOMException('Aborted', 'AbortError'));
            return Promise.resolve();
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        const stages: string[] = [];
        const promise = downloadModel({
            spec: baseSpec,
            signal: controller.signal,
            onProgress: (payload: ModelDownloadProgressPayload) => stages.push(payload.stage),
        });
        await vi.waitFor(() => expect(writeModelChunk).toHaveBeenCalledOnce());

        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(abortModelWrite).toHaveBeenCalledWith('write-1');
        expect(deleteModel).toHaveBeenCalledWith({ family: 'ddsp', modelId: 'violin-1' });
        expect(stages).not.toContain('complete');
    });

    it('stops before commit when the final download progress callback cancels', async () => {
        const controller = new AbortController();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        const stages: string[] = [];

        await expect(
            downloadModel({
                spec: baseSpec,
                signal: controller.signal,
                onProgress: (payload: ModelDownloadProgressPayload) => {
                    stages.push(payload.stage);
                    if (payload.stage === 'downloading') {
                        controller.abort();
                    }
                },
            })
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(abortModelWrite).toHaveBeenCalledWith('write-1');
        expect(commitModelWrite).not.toHaveBeenCalled();
        expect(stages).not.toContain('verifying');
        expect(stages).not.toContain('complete');
    });

    it('removes a committed model when cancellation arrives during the final storage check', async () => {
        const controller = new AbortController();
        const status = deferred<Awaited<ReturnType<typeof getStorageStatus>>>();
        getStorageStatus.mockReturnValue(status.promise);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );
        const stages: string[] = [];
        const promise = downloadModel({
            spec: baseSpec,
            signal: controller.signal,
            onProgress: (payload: ModelDownloadProgressPayload) => stages.push(payload.stage),
        });
        await vi.waitFor(() => expect(commitModelWrite).toHaveBeenCalledOnce());

        controller.abort();
        status.resolve({ usedBytes: 0, limitBytes: 1, persisted: true, availableBytes: 1 });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(deleteModel).toHaveBeenCalledWith({ family: 'ddsp', modelId: 'violin-1' });
        expect(stages).not.toContain('complete');
    });
});

describe('downloadModel archive guards', () => {
    it('cancels the reader before starting a declared oversized archive', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array([1])], 2 * 1024 * 1024 * 1024 + 1, cancel)))
        );

        await expect(
            downloadModel({ spec: { ...baseSpec, url: 'https://cdn.example/oversized.zip', sizeBytes: 1 } })
        ).rejects.toThrow(/archive byte limit/);
        expect(cancel).toHaveBeenCalledOnce();
        expect(beginModelWrite).not.toHaveBeenCalled();
    });

    it('aborts the partial write when an archive stream exceeds a smaller declared length', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const oversizedChunk = {
            byteLength: 2 * 1024 * 1024 * 1024 + 1,
        } as unknown as Uint8Array;
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([oversizedChunk], 1, cancel)))
        );

        await expect(
            downloadModel({ spec: { ...baseSpec, url: 'https://cdn.example/oversized.zip', sizeBytes: 1 } })
        ).rejects.toThrow(/archive byte limit/);

        expect(cancel).toHaveBeenCalledOnce();
        expect(abortModelWrite).toHaveBeenCalledWith('write-1');
        expect(writeModelChunk).not.toHaveBeenCalled();
    });

    it('does not retry a guarded archive rejection and cleans the temporary write', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.byteLength)))
        );
        commitModelWrite.mockRejectedValue(new ZipArchiveError('Unsafe archive path'));
        const stages: string[] = [];

        await expect(
            downloadModel({
                spec: { ...baseSpec, url: 'https://cdn.example/unsafe.zip', sizeBytes: bytes.byteLength },
                onProgress: (payload: ModelDownloadProgressPayload) => stages.push(payload.stage),
            })
        ).rejects.toBeInstanceOf(ZipArchiveError);
        expect(commitModelWrite).toHaveBeenCalledOnce();
        expect(abortModelWrite).toHaveBeenCalledOnce();
        expect(stages).not.toContain('complete');
    });
});
