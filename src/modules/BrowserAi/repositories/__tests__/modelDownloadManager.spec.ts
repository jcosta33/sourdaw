/**
 * Regression tests for the model download manager.
 *
 * Covers the memory / main-thread and cancellation bugs:
 *  - A single BroadcastChannel is held for the whole download, not constructed
 *    and closed per progress event.
 *  - Raw (non-ZIP, unverified) downloads stream chunks straight to an OPFS
 *    writable instead of accumulating every chunk in memory.
 *  - High-frequency progress updates are throttled (~10 Hz).
 *  - An AbortSignal interrupts the retry backoff: a cancelled download stops and
 *    does not mark the model 'error' after the user moved on.
 */

import { createHash } from 'node:crypto';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractGuardedZip, ZipArchiveError } from '#/infra/archive/extractGuardedZip';

import { type ModelDownloadProgressPayload } from '../../models/ModelDownloadProgress';
import { downloadModel } from '../modelDownloadManager';

// --- OPFS writable capture --------------------------------------------------

type WriteCall = number; // byteLength of each streamed chunk
let lastWritable: { writes: WriteCall[]; closed: boolean; aborted: boolean } | null = null;
let pendingWrite: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } | null = null;
let pendingStorageEstimate: { promise: Promise<StorageEstimate>; resolve: () => void } | null = null;
let removedEntries = 0;

function installStorage(): void {
    function makeWritable(): FileSystemWritableFileStream {
        const state = { writes: [] as WriteCall[], closed: false, aborted: false };
        lastWritable = state;
        return {
            write(chunk: ArrayBufferView | ArrayBuffer): Promise<void> {
                state.writes.push('byteLength' in chunk ? chunk.byteLength : (chunk as ArrayBuffer).byteLength);
                return pendingWrite?.promise ?? Promise.resolve();
            },
            close(): Promise<void> {
                state.closed = true;
                return Promise.resolve();
            },
            abort(): Promise<void> {
                state.aborted = true;
                pendingWrite?.reject(new DOMException('Aborted', 'AbortError'));
                return Promise.resolve();
            },
        } as unknown as FileSystemWritableFileStream;
    }

    const fileHandle = {
        kind: 'file',
        createWritable: vi.fn(() => Promise.resolve(makeWritable())),
    };
    const leafDir = {
        kind: 'directory',
        getDirectoryHandle: vi.fn(() => Promise.resolve(leafDir)),
        getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
        removeEntry: vi.fn(() => {
            removedEntries += 1;
            return Promise.resolve();
        }),
        // Empty directory — getStorageStatus iterates but measures nothing here.
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
            return { next: () => Promise.resolve({ done: true, value: undefined }) };
        },
    };
    Object.defineProperty(globalThis.navigator, 'storage', {
        configurable: true,
        value: {
            getDirectory: vi.fn(() => Promise.resolve(leafDir)),
            estimate: vi.fn(() => pendingStorageEstimate?.promise ?? Promise.resolve({ quota: 1e12, usage: 0 })),
            persisted: vi.fn(() => Promise.resolve(false)),
            persist: vi.fn(() => Promise.resolve(true)),
        },
    });
}

// --- BroadcastChannel capture ----------------------------------------------

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

// --- guarded ZIP worker ----------------------------------------------------

type GuardedZipWorkerRequest = { bytes: ArrayBuffer; suffix: string };
type GuardedZipWorkerResponse =
    | { type: 'success'; path: string; data: ArrayBuffer }
    | {
          type: 'error';
          code: 'invalid-archive';
          message: string;
      };

class FakeGuardedZipWorker {
    static instances: FakeGuardedZipWorker[] = [];
    static holdResponses = false;
    onmessage: ((event: MessageEvent<GuardedZipWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn((request: GuardedZipWorkerRequest) => {
        if (FakeGuardedZipWorker.holdResponses) {
            return;
        }
        queueMicrotask(() => {
            try {
                let selectedPath: string | undefined;
                const extracted = extractGuardedZip({
                    bytes: new Uint8Array(request.bytes),
                    validateInventory: (paths) => {
                        const matches = paths.filter((path) => path.endsWith(request.suffix));
                        if (matches.length !== 1) {
                            throw new Error(`Expected exactly one ${request.suffix} entry`);
                        }
                        selectedPath = matches[0];
                    },
                    include: (path) => path === selectedPath,
                });
                if (!selectedPath) {
                    throw new Error('Missing selected ZIP entry');
                }
                const data = extracted[selectedPath];
                if (!data) {
                    throw new Error('Missing extracted ZIP entry');
                }
                this.onmessage?.({
                    data: { type: 'success', path: selectedPath, data: data.slice().buffer },
                } as MessageEvent<GuardedZipWorkerResponse>);
            } catch (error) {
                this.onmessage?.({
                    data: {
                        type: 'error',
                        code: 'invalid-archive',
                        message: error instanceof Error ? error.message : String(error),
                    },
                } as MessageEvent<GuardedZipWorkerResponse>);
            }
        });
    });
    terminate = vi.fn();

    constructor() {
        FakeGuardedZipWorker.instances.push(this);
    }
}

// --- fetch helpers ----------------------------------------------------------

function streamingResponse(chunks: Uint8Array[], totalBytes: number, cancel = vi.fn()): Response {
    let i = 0;
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (h: string) => (h === 'content-length' ? String(totalBytes) : null) },
        body: {
            getReader() {
                return {
                    cancel,
                    read(): Promise<{ done: boolean; value?: Uint8Array }> {
                        if (i < chunks.length) {
                            return Promise.resolve({ done: false, value: chunks[i++] });
                        }
                        return Promise.resolve({ done: true, value: undefined });
                    },
                };
            },
        },
    } as unknown as Response;
}

// --- setup / teardown -------------------------------------------------------

beforeEach(() => {
    channelConstructions = 0;
    openChannels = 0;
    lastWritable = null;
    pendingWrite = null;
    pendingStorageEstimate = null;
    removedEntries = 0;
    FakeGuardedZipWorker.instances = [];
    FakeGuardedZipWorker.holdResponses = false;
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('Worker', FakeGuardedZipWorker);
    installStorage();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const baseSpec = {
    modelId: 'violin-1',
    family: 'ddsp',
    url: 'https://cdn.example/violin-1.onnx',
    sizeBytes: 30,
};

describe('downloadModel — streaming + single channel', () => {
    it('streams each chunk straight to the OPFS writable for a raw .onnx download', async () => {
        const chunks = [new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)];
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse(chunks, 30)))
        );

        await downloadModel({ spec: baseSpec });

        expect(lastWritable).not.toBeNull();
        // Each network chunk was written to OPFS as it arrived — not buffered and
        // written once at the end.
        expect(lastWritable?.writes).toEqual([10, 10, 10]);
        expect(lastWritable?.closed).toBe(true);
    });

    it('rejects and discards a streamed artifact whose byte count does not match its manifest', async () => {
        const bytes = new Uint8Array(3);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.length)))
        );

        await expect(downloadModel({ spec: { ...baseSpec, sizeBytes: bytes.length + 1 } })).rejects.toThrow(
            'Size check failed'
        );

        expect(lastWritable?.aborted).toBe(true);
        expect(lastWritable?.closed).toBe(false);
    });

    it('constructs exactly one BroadcastChannel for the whole download and closes it', async () => {
        const chunks = Array.from({ length: 20 }, () => new Uint8Array(10));
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse(chunks, 200)))
        );

        await downloadModel({ spec: { ...baseSpec, sizeBytes: 200 } });

        // One channel for the entire download (the old code built+closed one per chunk).
        expect(channelConstructions).toBe(1);
        // ...and it was closed (no leak).
        expect(openChannels).toBe(0);
    });

    it('throttles in-loop downloading progress to ~10 Hz', async () => {
        // 50 chunks delivered effectively instantly — without throttling this would
        // emit ~50 'downloading' events. At 10 Hz from a single timestamp window it
        // emits far fewer.
        const chunks = Array.from({ length: 50 }, () => new Uint8Array(4));
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse(chunks, 200)))
        );

        const downloadingEvents: number[] = [];
        await downloadModel({
            spec: { ...baseSpec, sizeBytes: 200 },
            onProgress: (p: ModelDownloadProgressPayload) => {
                if (p.stage === 'downloading') {
                    downloadingEvents.push(p.progress);
                }
            },
        });

        // 50 chunks would be 50 events un-throttled; throttling collapses the burst.
        expect(downloadingEvents.length).toBeLessThan(50);
    });
});

describe('downloadModel — cancellation', () => {
    it('interrupts the retry backoff and does not mark the model error after abort', async () => {
        const controller = new AbortController();
        // fetch always fails, so the manager enters its exponential backoff between
        // attempts. We abort during the first backoff window.
        const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
            if (init?.signal?.aborted) {
                return Promise.reject(new DOMException('Aborted', 'AbortError'));
            }
            return Promise.reject(new Error('network down'));
        });
        vi.stubGlobal('fetch', fetchMock);

        const errorEvents: string[] = [];
        const promise: Promise<void> = downloadModel({
            spec: baseSpec,
            signal: controller.signal,
            onProgress: (p: ModelDownloadProgressPayload) => {
                if (p.stage === 'error') {
                    errorEvents.push(p.stage);
                }
            },
        });

        // Let the first attempt fail and enter the 1000ms backoff, then abort.
        await Promise.resolve();
        await Promise.resolve();
        controller.abort();

        await expect(promise).rejects.toThrow();

        // The download was cancelled, not failed: no 'error' stage emitted, and the
        // channel was still cleaned up.
        expect(errorEvents).toEqual([]);
        expect(openChannels).toBe(0);
    });

    it('passes the AbortSignal through to fetch', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn((_url: string, _init?: { signal?: AbortSignal }) =>
            Promise.resolve(streamingResponse([new Uint8Array(30)], 30))
        );
        vi.stubGlobal('fetch', fetchMock);

        await downloadModel({ spec: baseSpec, signal: controller.signal });

        const init = fetchMock.mock.calls[0]?.[1];
        expect(init?.signal).toBe(controller.signal);
    });

    it('terminates in-flight archive extraction and publishes no model after abort', async () => {
        FakeGuardedZipWorker.holdResponses = true;
        const controller = new AbortController();
        const zipped = zipSync({ 'model/weights.onnx': new Uint8Array([10, 20, 30, 40]) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );

        const stages: string[] = [];
        const promise = downloadModel({
            spec: { ...baseSpec, url: 'https://cdn.example/violin-1.zip', sizeBytes: zipped.length },
            signal: controller.signal,
            onProgress: (payload) => stages.push(payload.stage),
        });

        await vi.waitFor(() => expect(FakeGuardedZipWorker.instances).toHaveLength(1));
        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(FakeGuardedZipWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
        expect(lastWritable).toBeNull();
        expect(stages).not.toContain('complete');
    });

    it('aborts a pending final OPFS write without publishing the model', async () => {
        let resolveWrite: (() => void) | undefined;
        let rejectWrite: ((error: unknown) => void) | undefined;
        pendingWrite = {
            promise: new Promise<void>((resolve, reject) => {
                resolveWrite = resolve;
                rejectWrite = reject;
            }),
            resolve: () => resolveWrite?.(),
            reject: (error) => rejectWrite?.(error),
        };
        const controller = new AbortController();
        const zipped = zipSync({ 'model/weights.onnx': new Uint8Array([10, 20, 30, 40]) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );
        const stages: string[] = [];
        const promise = downloadModel({
            spec: { ...baseSpec, url: 'https://cdn.example/violin-1.zip', sizeBytes: zipped.length },
            signal: controller.signal,
            onProgress: (payload) => stages.push(payload.stage),
        });

        await vi.waitFor(() => expect(lastWritable?.writes).toEqual([4]));
        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(lastWritable?.aborted).toBe(true);
        expect(lastWritable?.closed).toBe(false);
        expect(stages).not.toContain('complete');
    });

    it('aborts a pending streamed write when cancellation arrives', async () => {
        let resolveWrite: (() => void) | undefined;
        let rejectWrite: ((error: unknown) => void) | undefined;
        pendingWrite = {
            promise: new Promise<void>((resolve, reject) => {
                resolveWrite = resolve;
                rejectWrite = reject;
            }),
            resolve: () => resolveWrite?.(),
            reject: (error) => rejectWrite?.(error),
        };
        const controller = new AbortController();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array(30)], 30)))
        );

        const promise = downloadModel({ spec: baseSpec, signal: controller.signal });
        await vi.waitFor(() => expect(lastWritable?.writes).toEqual([30]));
        controller.abort();

        await vi.waitFor(() => expect(lastWritable?.aborted).toBe(true));
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(lastWritable?.closed).toBe(false);
    });

    it('removes a committed model when cancellation arrives during the final storage check', async () => {
        let resolveEstimate: (() => void) | undefined;
        pendingStorageEstimate = {
            promise: new Promise<StorageEstimate>((resolve) => {
                resolveEstimate = () => resolve({ quota: 1e12, usage: 0 });
            }),
            resolve: () => resolveEstimate?.(),
        };
        const controller = new AbortController();
        const zipped = zipSync({ 'model/weights.onnx': new Uint8Array([10, 20, 30, 40]) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );
        const stages: string[] = [];
        const promise = downloadModel({
            spec: { ...baseSpec, url: 'https://cdn.example/violin-1.zip', sizeBytes: zipped.length },
            signal: controller.signal,
            onProgress: (payload) => stages.push(payload.stage),
        });

        await vi.waitFor(() => expect(lastWritable?.closed).toBe(true));
        controller.abort();
        pendingStorageEstimate.resolve();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(removedEntries).toBe(1);
        expect(stages).not.toContain('complete');
    });
});

describe('downloadModel — buffered path (sha256 verification + ZIP extraction)', () => {
    it('stops before concatenation and verification when the final download progress callback cancels', async () => {
        const controller = new AbortController();
        const zipped = zipSync({ 'model/weights.onnx': new Uint8Array([10, 20, 30, 40]) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );
        const stages: string[] = [];

        const promise = downloadModel({
            spec: { ...baseSpec, url: 'https://cdn.example/violin-1.zip', sizeBytes: zipped.length },
            signal: controller.signal,
            onProgress: (payload) => {
                stages.push(payload.stage);
                if (payload.stage === 'downloading') {
                    controller.abort();
                }
            },
        });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(stages).not.toContain('verifying');
        expect(stages).not.toContain('extracting');
        expect(FakeGuardedZipWorker.instances).toEqual([]);
    });

    it('verifies a matching sha256 and writes the fully-buffered data via writeModel', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.length)))
        );

        const stages: string[] = [];
        await downloadModel({
            spec: { ...baseSpec, sizeBytes: bytes.length, sha256 },
            onProgress: (p: ModelDownloadProgressPayload) => stages.push(p.stage),
        });

        // Buffered path writes once, through writeModel — not the streaming writable.
        expect(lastWritable?.writes).toEqual([bytes.length]);
        expect(lastWritable?.closed).toBe(true);
        expect(stages).toContain('verifying');
        expect(stages).toContain('complete');
        expect(stages).not.toContain('extracting');
    });

    it('rejects a verified artifact whose byte count does not match its manifest', async () => {
        vi.useFakeTimers();
        const bytes = new Uint8Array([1, 2, 3]);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const fetchMock = vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.length)));
        vi.stubGlobal('fetch', fetchMock);

        try {
            const promise = downloadModel({
                spec: { ...baseSpec, sizeBytes: bytes.length + 1, sha256 },
            });
            const errorPromise: Promise<unknown> = promise.catch((error: unknown) => error);
            await vi.runAllTimersAsync();
            const error = await errorPromise;

            expect(error).toBeInstanceOf(Error);
            expect(String(error)).toContain('Size check failed');
            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(lastWritable).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('retries and ultimately fails when the sha256 does not match', async () => {
        const bytes = new Uint8Array([9, 9, 9]);
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([bytes], bytes.length)))
        );

        const errorEvents: ModelDownloadProgressPayload[] = [];
        const promise = downloadModel({
            spec: { ...baseSpec, sizeBytes: bytes.length, sha256: 'deadbeefdeadbeef' },
            onProgress: (p: ModelDownloadProgressPayload) => {
                if (p.stage === 'error') {
                    errorEvents.push(p);
                }
            },
        });

        // Real exponential backoff between the 3 attempts (~1s + ~2s) — no fake
        // timers here since the sha256 digest is a genuine async WebCrypto call.
        await expect(promise).rejects.toThrow(/Failed to download/);
        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0]?.error).toContain('Integrity check failed');
    }, 10_000);

    it('extracts the .onnx entry from a .zip package and stores only its bytes', async () => {
        const onnxBytes = new Uint8Array([10, 20, 30, 40]);
        const zipped = zipSync({ 'model/weights.onnx': onnxBytes });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );

        const stages: string[] = [];
        await downloadModel({
            spec: { ...baseSpec, url: 'https://cdn.example/violin-1.zip', sizeBytes: zipped.length },
            onProgress: (p: ModelDownloadProgressPayload) => stages.push(p.stage),
        });

        expect(stages).toContain('extracting');
        expect(stages).toContain('complete');
        // Only the extracted .onnx bytes reach OPFS — not the whole ZIP.
        expect(lastWritable?.writes).toEqual([onnxBytes.length]);
        expect(FakeGuardedZipWorker.instances).toHaveLength(1);
        expect(FakeGuardedZipWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    });

    it('recognizes container pathnames regardless of URL query, fragment, or extension case', async () => {
        const onnxBytes = new Uint8Array([10, 20, 30, 40]);
        const zipped = zipSync({ 'model/weights.onnx': onnxBytes });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );

        await downloadModel({
            spec: {
                ...baseSpec,
                url: 'https://cdn.example/violin-1.ZIP?download=1#model',
                sizeBytes: zipped.length,
            },
        });

        expect(FakeGuardedZipWorker.instances).toHaveLength(1);
        expect(lastWritable?.writes).toEqual([onnxBytes.length]);
    });

    it('cancels the reader before buffering a declared oversized archive', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array([1])], 2 * 1024 * 1024 * 1024 + 1, cancel)))
        );

        await expect(
            downloadModel({
                spec: { ...baseSpec, url: 'https://cdn.example/oversized.zip', sizeBytes: 1 },
            })
        ).rejects.toThrow(/archive byte limit/);
        expect(cancel).toHaveBeenCalledOnce();
        expect(FakeGuardedZipWorker.instances).toEqual([]);
        expect(lastWritable).toBeNull();
    });

    it('rejects an unsafe model archive without publishing an OPFS artifact', async () => {
        vi.useFakeTimers();
        const zipped = zipSync({ '../weights.onnx': new Uint8Array([10, 20, 30, 40]) });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([zipped], zipped.length)))
        );
        const stages: string[] = [];

        try {
            const promise = downloadModel({
                spec: { ...baseSpec, url: 'https://cdn.example/unsafe.zip', sizeBytes: zipped.length },
                onProgress: (payload) => stages.push(payload.stage),
            });
            const errorPromise: Promise<unknown> = promise.catch((error: unknown) => error);
            await vi.runAllTimersAsync();
            const error = await errorPromise;

            expect(error).toBeInstanceOf(ZipArchiveError);
            if (!(error instanceof Error)) {
                throw new Error('Expected an archive error');
            }
            expect(error.message).toContain('Unsafe archive path');
            expect(FakeGuardedZipWorker.instances).toHaveLength(1);
            expect(lastWritable).toBeNull();
            expect(stages).not.toContain('storing');
            expect(stages).not.toContain('complete');
        } finally {
            vi.useRealTimers();
        }
    });
});
