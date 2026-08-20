import { describe, expect, it, vi } from 'vitest';

import { ZipArchiveError } from '#/infra/archive/extractGuardedZip';

import { type ModelStorageWorkerResponse } from '../../models/ModelStorageWorkerProtocol';
import { createModelStorageRequestHandler } from '../modelStorageWorkerRuntime';

type SyncAccessHandle = {
    close: () => void;
    flush: () => void;
    getSize: () => number;
    read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
    truncate: (size: number) => void;
    write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
};

function readAccess(bytes: Uint8Array): SyncAccessHandle {
    return {
        close: vi.fn(),
        flush: vi.fn(),
        getSize: vi.fn(() => bytes.byteLength),
        read: vi.fn((target: ArrayBufferView, options?: { at?: number }) => {
            const output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
            const at = options?.at ?? 0;
            const source = bytes.subarray(at, at + output.byteLength);
            output.set(source);
            return source.byteLength;
        }),
        truncate: vi.fn(),
        write: vi.fn(),
    };
}

describe('modelStorageWorkerRuntime', () => {
    it('opens verified reads in read-only mode and transfers the exact bytes to the destination port', async () => {
        const expectedBytes = Uint8Array.from([7, 11, 13, 17]);
        const syncAccess = readAccess(expectedBytes);
        const createSyncAccessHandle = vi.fn(() => Promise.resolve(syncAccess));
        const fileHandle = { createSyncAccessHandle } as unknown as FileSystemFileHandle;
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const destinationPostMessage = vi.fn();
        const destinationPort = {
            postMessage: destinationPostMessage,
            close: vi.fn(),
        } as unknown as MessagePort;
        const responses: ModelStorageWorkerResponse[] = [];
        const sha256 = vi.fn(() => Promise.resolve('verified'));
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256,
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'read-model',
            requestId: 'read-1',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: expectedBytes.byteLength,
            expectedSha256: 'verified',
            destinationPort,
        });

        expect(createSyncAccessHandle).toHaveBeenCalledWith({ mode: 'read-only' });
        expect(sha256).toHaveBeenCalledOnce();
        const transferred = destinationPostMessage.mock.calls[0]?.[0] as
            { type: string; modelData: ArrayBuffer } | undefined;
        expect(transferred?.type).toBe('model-data');
        expect(new Uint8Array(transferred?.modelData ?? new ArrayBuffer(0))).toEqual(expectedBytes);
        expect(destinationPostMessage.mock.calls[0]?.[1]).toEqual([transferred?.modelData]);
        expect(responses).toContainEqual({ type: 'read-complete', requestId: 'read-1', found: true });
        expect(destinationPort.close).toHaveBeenCalledOnce();
        expect(syncAccess.close).toHaveBeenCalledOnce();
    });

    it('closes the destination port when a model is not found', async () => {
        const destinationPort = {
            postMessage: vi.fn(),
            close: vi.fn(),
        } as unknown as MessagePort;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.reject(new DOMException('missing', 'NotFoundError')),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'read-model',
            requestId: 'read-missing',
            family: 'kokoro',
            modelId: 'model.onnx',
            destinationPort,
        });

        expect(destinationPort.postMessage).not.toHaveBeenCalled();
        expect(destinationPort.close).toHaveBeenCalledOnce();
        expect(responses).toContainEqual({ type: 'read-complete', requestId: 'read-missing', found: false });
    });

    it('posts the read error and closes the destination port when model access fails', async () => {
        const destinationPort = {
            postMessage: vi.fn(),
            close: vi.fn(),
        } as unknown as MessagePort;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.reject(new Error('opfs failed')),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'read-model',
            requestId: 'read-error',
            family: 'kokoro',
            modelId: 'model.onnx',
            destinationPort,
        });

        expect(destinationPort.postMessage).toHaveBeenCalledWith({
            type: 'model-error',
            name: 'Error',
            message: 'opfs failed',
        });
        expect(destinationPort.close).toHaveBeenCalledOnce();
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'read-error',
            name: 'Error',
            message: 'opfs failed',
        });
    });

    it('streams writes through an exclusive readwrite handle and publishes the temporary file by move', async () => {
        const written: number[] = [];
        const syncAccess: SyncAccessHandle = {
            close: vi.fn(),
            flush: vi.fn(),
            getSize: vi.fn(() => written.length),
            read: vi.fn(),
            truncate: vi.fn((size) => written.splice(size)),
            write: vi.fn((input: ArrayBufferView, options?: { at?: number }) => {
                const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                const at = options?.at ?? 0;
                for (let index = 0; index < bytes.byteLength; index += 1) {
                    written[at + index] = bytes[index] ?? 0;
                }
                return bytes.byteLength;
            }),
        };
        const move = vi.fn(() => Promise.resolve());
        const createSyncAccessHandle = vi.fn(() => Promise.resolve(syncAccess));
        const temporaryFile = { createSyncAccessHandle, move } as unknown as FileSystemFileHandle;
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256: () => Promise.resolve('unused'),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-1',
            writeId: 'write-1',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSha256: undefined,
            archive: false,
        });
        const chunk = Uint8Array.from([2, 3, 5, 7]).buffer;
        await handler({ type: 'write-model-chunk', requestId: 'chunk-1', writeId: 'write-1', chunk });
        await handler({ type: 'commit-model-write', requestId: 'commit-1', writeId: 'write-1' });

        expect(createSyncAccessHandle).toHaveBeenCalledWith({ mode: 'readwrite' });
        expect(written).toEqual([2, 3, 5, 7]);
        expect(syncAccess.flush).toHaveBeenCalledOnce();
        expect(syncAccess.close).toHaveBeenCalledOnce();
        expect(move).toHaveBeenCalledWith(familyDirectory, 'model.onnx');
        expect(responses).toContainEqual({
            type: 'write-committed',
            requestId: 'commit-1',
            storedBytes: 4,
            extractedPath: null,
        });
    });

    it('deletes a cached model that fails exact release verification without transferring its bytes', async () => {
        const syncAccess = readAccess(Uint8Array.from([1, 2, 3]));
        const fileHandle = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(syncAccess)),
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const destinationPostMessage = vi.fn();
        const destinationPort = {
            postMessage: destinationPostMessage,
            close: vi.fn(),
        } as unknown as MessagePort;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256: () => Promise.resolve('wrong'),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'read-model',
            requestId: 'read-invalid',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 3,
            expectedSha256: 'verified',
            destinationPort,
        });

        expect(removeEntry).toHaveBeenCalledWith('model.onnx');
        expect(destinationPostMessage).not.toHaveBeenCalled();
        expect(responses).toContainEqual({ type: 'read-complete', requestId: 'read-invalid', found: false });
    });

    it('verifies startup readiness entirely in the worker and removes invalid cached bytes', async () => {
        const syncAccess = readAccess(Uint8Array.from([4, 5, 6]));
        const fileHandle = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(syncAccess)),
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn((name: string) =>
                Promise.resolve(
                    name === 'models'
                        ? ({
                              getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
                          } as unknown as FileSystemDirectoryHandle)
                        : familyDirectory
                )
            ),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256: () => Promise.resolve('wrong'),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'verify-model',
            requestId: 'verify-1',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 3,
            expectedSha256: 'verified',
        });

        expect(removeEntry).toHaveBeenCalledWith('model.onnx');
        expect(responses).toContainEqual({ type: 'model-verified', requestId: 'verify-1', verified: false });
    });

    it('verifies and extracts archives off the renderer before atomically publishing only ONNX bytes', async () => {
        let stored = new Uint8Array(0);
        function access(): SyncAccessHandle {
            return {
                close: vi.fn(),
                flush: vi.fn(),
                getSize: vi.fn(() => stored.byteLength),
                read: vi.fn((target: ArrayBufferView, options?: { at?: number }) => {
                    const output = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
                    const source = stored.subarray(options?.at ?? 0, (options?.at ?? 0) + output.byteLength);
                    output.set(source);
                    return source.byteLength;
                }),
                truncate: vi.fn((size) => {
                    stored = stored.slice(0, size);
                }),
                write: vi.fn((input: ArrayBufferView, options?: { at?: number }) => {
                    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                    const at = options?.at ?? 0;
                    const next = new Uint8Array(Math.max(stored.byteLength, at + bytes.byteLength));
                    next.set(stored);
                    next.set(bytes, at);
                    stored = next;
                    return bytes.byteLength;
                }),
            };
        }
        const accesses = [access(), access(), access()];
        const createSyncAccessHandle = vi.fn((_options: { mode: 'read-only' | 'readwrite' }) =>
            Promise.resolve(accesses.shift() ?? access())
        );
        const move = vi.fn(() => Promise.resolve());
        const temporaryFile = { createSyncAccessHandle, move } as unknown as FileSystemFileHandle;
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
            removeEntry: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const archiveBytes = Uint8Array.from([9, 8, 7]);
        const onnxBytes = Uint8Array.from([2, 3, 5, 7]);
        const extractArchive = vi.fn(() => Promise.resolve({ path: 'package/model.onnx', data: onnxBytes }));
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256: () => Promise.resolve('verified'),
            extractArchive,
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-archive',
            writeId: 'write-archive',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: archiveBytes.byteLength,
            expectedSha256: 'verified',
            archive: true,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-archive',
            writeId: 'write-archive',
            chunk: archiveBytes.buffer,
        });
        await handler({ type: 'commit-model-write', requestId: 'commit-archive', writeId: 'write-archive' });

        expect(extractArchive).toHaveBeenCalledWith({
            bytes: archiveBytes,
            suffix: '.onnx',
            signal: expect.any(AbortSignal),
        });
        expect(createSyncAccessHandle.mock.calls.map(([options]) => options)).toEqual([
            { mode: 'readwrite' },
            { mode: 'read-only' },
            { mode: 'readwrite' },
        ]);
        expect(stored).toEqual(onnxBytes);
        expect(move).toHaveBeenCalledWith(familyDirectory, 'model.onnx');
        expect(responses.filter((response) => response.type === 'write-progress')).toEqual([
            { type: 'write-progress', requestId: 'commit-archive', stage: 'verifying' },
            { type: 'write-progress', requestId: 'commit-archive', stage: 'extracting' },
            { type: 'write-progress', requestId: 'commit-archive', stage: 'storing' },
        ]);
    });

    it('removes the temporary file when guarded archive extraction rejects', async () => {
        const stored = Uint8Array.from([1, 2, 3]);
        const writeAccess = readAccess(stored);
        writeAccess.write = vi.fn((input) => input.byteLength);
        const readOnlyAccess = readAccess(stored);
        const createSyncAccessHandle = vi.fn().mockResolvedValueOnce(writeAccess).mockResolvedValueOnce(readOnlyAccess);
        const move = vi.fn(() => Promise.resolve());
        const temporaryFile = { createSyncAccessHandle, move } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() =>
                Promise.resolve({
                    getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
                } as unknown as FileSystemDirectoryHandle)
            ),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            extractArchive: () => Promise.reject(new ZipArchiveError('Unsafe archive path')),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-unsafe',
            writeId: 'write-unsafe',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: stored.byteLength,
            archive: true,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-unsafe',
            writeId: 'write-unsafe',
            chunk: stored.buffer,
        });
        await handler({ type: 'commit-model-write', requestId: 'commit-unsafe', writeId: 'write-unsafe' });

        expect(removeEntry).toHaveBeenCalledWith('.sourdaw-write-unsafe.partial');
        expect(move).not.toHaveBeenCalled();
        expect(responses).not.toContainEqual(expect.objectContaining({ type: 'write-committed' }));
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'commit-unsafe',
            name: 'ZipArchiveError',
            message: 'Unsafe archive path',
        });
    });

    it('removes downloaded bytes instead of publishing a model when SHA-256 verification fails', async () => {
        const stored = Uint8Array.from([1, 2, 3]);
        const writeAccess = readAccess(stored);
        writeAccess.write = vi.fn((input) => input.byteLength);
        const readOnlyAccess = readAccess(stored);
        const move = vi.fn(() => Promise.resolve());
        const temporaryFile = {
            createSyncAccessHandle: vi.fn().mockResolvedValueOnce(writeAccess).mockResolvedValueOnce(readOnlyAccess),
            move,
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() =>
                Promise.resolve({
                    getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
                } as unknown as FileSystemDirectoryHandle)
            ),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256: () => Promise.resolve('wrong'),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-digest',
            writeId: 'write-digest',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: stored.byteLength,
            expectedSha256: 'verified',
            archive: false,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-digest',
            writeId: 'write-digest',
            chunk: stored.buffer,
        });
        await handler({ type: 'commit-model-write', requestId: 'commit-digest', writeId: 'write-digest' });

        expect(removeEntry).toHaveBeenCalledWith('.sourdaw-write-digest.partial');
        expect(move).not.toHaveBeenCalled();
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'commit-digest',
            name: 'Error',
            message: 'Integrity check failed for model.onnx: expected verified, got wrong',
        });
    });

    it('aborts guarded extraction and cleans its partial file when cancellation arrives', async () => {
        const stored = Uint8Array.from([1, 2, 3]);
        const writeAccess = readAccess(stored);
        writeAccess.write = vi.fn((input) => input.byteLength);
        const readOnlyAccess = readAccess(stored);
        const move = vi.fn(() => Promise.resolve());
        const temporaryFile = {
            createSyncAccessHandle: vi.fn().mockResolvedValueOnce(writeAccess).mockResolvedValueOnce(readOnlyAccess),
            move,
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() =>
                Promise.resolve({
                    getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
                } as unknown as FileSystemDirectoryHandle)
            ),
        } as unknown as FileSystemDirectoryHandle;
        let extractionSignal: AbortSignal | undefined;
        const extractArchive = vi.fn(
            ({ signal }: { bytes: Uint8Array<ArrayBuffer>; suffix: string; signal?: AbortSignal }) =>
                new Promise<{ path: string; data: Uint8Array<ArrayBuffer> }>((_resolve, reject) => {
                    extractionSignal = signal;
                    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            extractArchive,
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-cancel',
            writeId: 'write-cancel',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: stored.byteLength,
            archive: true,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-cancel',
            writeId: 'write-cancel',
            chunk: stored.buffer,
        });
        const commit = handler({
            type: 'commit-model-write',
            requestId: 'commit-cancel',
            writeId: 'write-cancel',
        });
        await vi.waitFor(() => expect(extractArchive).toHaveBeenCalledOnce());

        await handler({ type: 'abort-model-write', requestId: 'abort-cancel', writeId: 'write-cancel' });
        await commit;

        expect(extractionSignal?.aborted).toBe(true);
        expect(removeEntry).toHaveBeenCalledWith('.sourdaw-write-cancel.partial');
        expect(move).not.toHaveBeenCalled();
        expect(responses).toContainEqual({ type: 'write-aborted', requestId: 'abort-cancel' });
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'commit-cancel',
            name: 'AbortError',
            message: 'Aborted',
        });
    });

    it('closes the exclusive handle and removes partial bytes when a write is aborted', async () => {
        const syncAccess = readAccess(new Uint8Array(0));
        const temporaryFile = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(syncAccess)),
            move: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() =>
                Promise.resolve({
                    getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
                } as unknown as FileSystemDirectoryHandle)
            ),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-abort',
            writeId: 'write-abort',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        await handler({ type: 'abort-model-write', requestId: 'abort-1', writeId: 'write-abort' });

        expect(syncAccess.close).toHaveBeenCalledOnce();
        expect(removeEntry).toHaveBeenCalledWith('.sourdaw-write-abort.partial');
        expect(responses).toContainEqual({ type: 'write-aborted', requestId: 'abort-1' });
    });

    it('reports a nested cache miss without hiding non-not-found storage failures', async () => {
        const notFound = new DOMException('missing', 'NotFoundError');
        const permissionError = new DOMException('denied', 'NotAllowedError');
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.reject(notFound)),
        } as unknown as FileSystemDirectoryHandle;
        const getRoot = vi
            .fn<() => Promise<FileSystemDirectoryHandle>>()
            .mockResolvedValueOnce({
                getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
            } as unknown as FileSystemDirectoryHandle)
            .mockRejectedValueOnce(permissionError);
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot,
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'check-model',
            requestId: 'check-missing',
            family: 'diffsinger/vocoder',
            modelId: 'model.onnx',
        });
        await handler({
            type: 'check-model',
            requestId: 'check-denied',
            family: 'kokoro',
            modelId: 'model.onnx',
        });

        expect(responses).toContainEqual({
            type: 'model-checked',
            requestId: 'check-missing',
            cached: false,
        });
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'check-denied',
            name: 'NotAllowedError',
            message: 'denied',
        });
    });

    it('measures only BrowserAi model and render bytes', async () => {
        const file = (size: number) =>
            ({
                kind: 'file',
                getFile: vi.fn(() => Promise.resolve({ size })),
            }) as unknown as FileSystemFileHandle;
        const directory = (
            entries: Array<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
        ): FileSystemDirectoryHandle =>
            ({
                kind: 'directory',
                async *[Symbol.asyncIterator]() {
                    yield* entries;
                },
            }) as unknown as FileSystemDirectoryHandle;
        const models = directory([['kokoro.onnx', file(100)]]);
        const renders = directory([['nested', directory([['phrase.pcm', file(20)]])]]);
        const getDirectoryHandle = vi.fn((name: string) => {
            if (name === 'models') {
                return Promise.resolve(models);
            }
            if (name === 'renders') {
                return Promise.resolve(renders);
            }
            return Promise.reject(new Error(`Unexpected directory: ${name}`));
        });
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve({ getDirectoryHandle } as unknown as FileSystemDirectoryHandle),
            postResponse: (response) => responses.push(response),
        });

        await handler({ type: 'measure-storage', requestId: 'measure-1' });

        expect(getDirectoryHandle.mock.calls.map(([name]) => name)).toEqual(['models', 'renders']);
        expect(responses).toContainEqual({
            type: 'storage-measured',
            requestId: 'measure-1',
            usedBytes: 120,
        });
    });

    it('scavenges orphan model partials while preserving an active write partial', async () => {
        const activeWriteId = 'write-active';
        const activeTemporaryName = `.sourdaw-${activeWriteId}.partial`;
        const orphanTemporaryName = '.sourdaw-write-orphan.partial';
        const file = (size: number) =>
            ({
                kind: 'file',
                getFile: vi.fn(() => Promise.resolve({ size })),
            }) as unknown as FileSystemFileHandle;
        const activeAccess = readAccess(new Uint8Array(0));
        const activeTemporaryFile = {
            kind: 'file',
            createSyncAccessHandle: vi.fn(() => Promise.resolve(activeAccess)),
            getFile: vi.fn(() => Promise.resolve({ size: 40 })),
            move: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            kind: 'directory',
            getFileHandle: vi.fn((name: string) => {
                if (name === activeTemporaryName) {
                    return Promise.resolve(activeTemporaryFile);
                }
                return Promise.reject(new Error(`Unexpected file: ${name}`));
            }),
            removeEntry,
            async *[Symbol.asyncIterator]() {
                yield ['model.onnx', file(100)] as const;
                yield [orphanTemporaryName, file(30)] as const;
                yield [activeTemporaryName, activeTemporaryFile] as const;
            },
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            kind: 'directory',
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
            async *[Symbol.asyncIterator]() {
                yield ['kokoro', familyDirectory] as const;
            },
        } as unknown as FileSystemDirectoryHandle;
        const rendersDirectory = {
            kind: 'directory',
            async *[Symbol.asyncIterator]() {
                yield ['phrase.pcm', file(20)] as const;
            },
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn((name: string) => {
                if (name === 'models') {
                    return Promise.resolve(modelsDirectory);
                }
                if (name === 'renders') {
                    return Promise.resolve(rendersDirectory);
                }
                return Promise.reject(new Error(`Unexpected directory: ${name}`));
            }),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-active',
            writeId: activeWriteId,
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        await handler({ type: 'measure-storage', requestId: 'measure-partials' });

        expect(removeEntry).toHaveBeenCalledOnce();
        expect(removeEntry).toHaveBeenCalledWith(orphanTemporaryName);
        expect(removeEntry).not.toHaveBeenCalledWith(activeTemporaryName);
        expect(responses).toContainEqual({
            type: 'storage-measured',
            requestId: 'measure-partials',
            usedBytes: 120,
        });
    });

    it('treats deletion of an already absent model as successful cleanup', async () => {
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.reject(new DOMException('missing', 'NotFoundError'))),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'delete-model',
            requestId: 'delete-missing',
            family: 'kokoro',
            modelId: 'model.onnx',
        });

        expect(responses).toContainEqual({ type: 'model-deleted', requestId: 'delete-missing' });
    });

    it('preserves nested family layout when deleting a model', async () => {
        const removeEntry = vi.fn(() => Promise.resolve());
        const vocoderDirectory = { removeEntry } as unknown as FileSystemDirectoryHandle;
        const diffSingerDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(vocoderDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(diffSingerDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'delete-model',
            requestId: 'delete-1',
            family: 'diffsinger/vocoder',
            modelId: 'model.onnx',
        });

        expect(root.getDirectoryHandle).toHaveBeenCalledWith('models', { create: false });
        expect(modelsDirectory.getDirectoryHandle).toHaveBeenCalledWith('diffsinger', { create: false });
        expect(diffSingerDirectory.getDirectoryHandle).toHaveBeenCalledWith('vocoder', { create: false });
        expect(removeEntry).toHaveBeenCalledWith('model.onnx');
        expect(responses).toContainEqual({ type: 'model-deleted', requestId: 'delete-1' });
    });
});
