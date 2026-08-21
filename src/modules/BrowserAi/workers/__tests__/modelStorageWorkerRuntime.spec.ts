import { describe, expect, it, vi } from 'vitest';

import { ZipArchiveError } from '#/infra/archive/extractGuardedZip';

import { type ModelStorageWorkerResponse } from '../../models/ModelStorageWorkerProtocol';
import { createModelStorageRequestHandler as createRuntimeModelStorageRequestHandler } from '../modelStorageWorkerRuntime';

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolvePromise: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: (value) => resolvePromise?.(value) };
}

type TestLockLease = { release: () => Promise<void> };
type TestLockPort = {
    acquireExclusive: (name: string) => Promise<TestLockLease>;
    tryAcquireExclusive: (name: string) => Promise<TestLockLease | null>;
};

class TestOriginLocks {
    private readonly active = new Map<string, { owner: string; release: () => Promise<void> }>();
    private readonly waiters = new Map<string, Array<(lease: TestLockLease) => void>>();

    port(owner: string): TestLockPort {
        return {
            acquireExclusive: (name) => this.acquire(owner, name),
            tryAcquireExclusive: (name) => Promise.resolve(this.active.has(name) ? null : this.activate(owner, name)),
        };
    }

    async crash(owner: string): Promise<void> {
        const releases = [...this.active.values()]
            .filter((entry) => entry.owner === owner)
            .map((entry) => entry.release());
        await Promise.all(releases);
    }

    private acquire(owner: string, name: string): Promise<TestLockLease> {
        if (!this.active.has(name)) {
            return Promise.resolve(this.activate(owner, name));
        }
        return new Promise<TestLockLease>((resolve) => {
            const waiters = this.waiters.get(name) ?? [];
            waiters.push(resolve);
            this.waiters.set(name, waiters);
        }).then(() => this.activate(owner, name));
    }

    private activate(owner: string, name: string): TestLockLease {
        let released = false;
        const lease: TestLockLease = {
            release: async () => {
                if (released) {
                    return;
                }
                released = true;
                this.active.delete(name);
                const next = this.waiters.get(name)?.shift();
                if (next) {
                    next(lease);
                }
            },
        };
        this.active.set(name, { owner, release: lease.release });
        return lease;
    }
}

function createModelStorageRequestHandler(
    input: Parameters<typeof createRuntimeModelStorageRequestHandler>[0]
): ReturnType<typeof createRuntimeModelStorageRequestHandler> {
    const locks = new TestOriginLocks();
    return createRuntimeModelStorageRequestHandler({ locks: locks.port('handler'), ...input });
}

async function expectReplacementWriteCanAcquire(input: {
    locks: TestOriginLocks;
    root: FileSystemDirectoryHandle;
    writeId: string;
}): Promise<void> {
    const responses: ModelStorageWorkerResponse[] = [];
    const replacement = createRuntimeModelStorageRequestHandler({
        getRoot: () => Promise.resolve(input.root),
        locks: input.locks.port(`replacement-${input.writeId}`),
        postResponse: (response) => responses.push(response),
    });
    const begin = replacement({
        type: 'begin-model-write',
        requestId: `begin-replacement-${input.writeId}`,
        writeId: input.writeId,
        family: 'kokoro',
        modelId: 'model.onnx',
        archive: false,
    });
    let settled = false;
    void begin.then(() => {
        settled = true;
    });
    await vi.waitFor(() => expect(settled).toBe(true));
    await begin;
    expect(responses).toContainEqual({
        type: 'write-begun',
        requestId: `begin-replacement-${input.writeId}`,
    });
    await replacement({
        type: 'abort-model-write',
        requestId: `abort-replacement-${input.writeId}`,
        writeId: input.writeId,
    });
}

function createWriteStorage(write: SyncAccessHandle['write']): {
    move: ReturnType<typeof vi.fn>;
    removeEntry: ReturnType<typeof vi.fn>;
    root: FileSystemDirectoryHandle;
    syncAccess: SyncAccessHandle;
} {
    const syncAccess = readAccess(new Uint8Array(0));
    syncAccess.write = write;
    const move = vi.fn(() => Promise.resolve());
    const temporaryFile = {
        createSyncAccessHandle: vi.fn(() => Promise.resolve(syncAccess)),
        move,
    } as unknown as FileSystemFileHandle;
    const removeEntry = vi.fn(() => Promise.resolve());
    const familyDirectory = {
        getFileHandle: vi.fn(() => Promise.resolve(temporaryFile)),
        removeEntry,
    } as unknown as FileSystemDirectoryHandle;
    const modelsDirectory = {
        getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
    } as unknown as FileSystemDirectoryHandle;
    const root = {
        getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
    } as unknown as FileSystemDirectoryHandle;
    return { move, removeEntry, root, syncAccess };
}

function createMutableStorageTree(): {
    files: Map<string, FileSystemFileHandle>;
    removeEntry: ReturnType<typeof vi.fn>;
    root: FileSystemDirectoryHandle;
} {
    const file = (size: number) =>
        ({
            kind: 'file',
            getFile: vi.fn(() => Promise.resolve({ size })),
        }) as unknown as FileSystemFileHandle;
    const files = new Map<string, FileSystemFileHandle>([['model.onnx', file(100)]]);
    const removeEntry = vi.fn(async (name: string) => {
        files.delete(name);
    });
    const familyDirectory = {
        kind: 'directory',
        getFileHandle: vi.fn((name: string, options?: { create?: boolean }) => {
            const existing = files.get(name);
            if (existing) {
                return Promise.resolve(existing);
            }
            if (!options?.create) {
                return Promise.reject(new DOMException('missing', 'NotFoundError'));
            }
            const access = readAccess(new Uint8Array(0));
            const temporaryFile = {
                kind: 'file',
                createSyncAccessHandle: vi.fn(() => Promise.resolve(access)),
                getFile: vi.fn(() => Promise.resolve({ size: 40 })),
                move: vi.fn(async (_destination: FileSystemDirectoryHandle, finalName: string) => {
                    files.delete(name);
                    files.set(finalName, temporaryFile);
                }),
            } as unknown as FileSystemFileHandle;
            files.set(name, temporaryFile);
            return Promise.resolve(temporaryFile);
        }),
        removeEntry,
        async *[Symbol.asyncIterator]() {
            yield* files.entries();
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
    return { files, removeEntry, root };
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
        const sha256 = vi.fn((bytes: ArrayBuffer) =>
            Promise.resolve(
                new Uint8Array(bytes).every((byte, index) => byte === expectedBytes[index]) ? 'verified' : 'wrong'
            )
        );
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
        expect(new Uint8Array(sha256.mock.calls[0]?.[0] ?? new ArrayBuffer(0))).toEqual(expectedBytes);
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
        const originLocks = new TestOriginLocks();
        const handler = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('commit-writer'),
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
        await expectReplacementWriteCanAcquire({ locks: originLocks, root, writeId: 'write-1' });
    });

    it('aborts before writing a chunk that would exceed the expected model size', async () => {
        const write = vi.fn((input: ArrayBufferView) => input.byteLength);
        const syncAccess = readAccess(new Uint8Array(0));
        syncAccess.write = write;
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
                    async *[Symbol.asyncIterator]() {},
                } as unknown as FileSystemDirectoryHandle)
            ),
        } as unknown as FileSystemDirectoryHandle;
        const responses: ModelStorageWorkerResponse[] = [];
        const originLocks = new TestOriginLocks();
        const handler = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('bounded-writer'),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: 'begin-bounded',
            writeId: 'write-bounded',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 4,
            archive: false,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-within-bound',
            writeId: 'write-bounded',
            chunk: Uint8Array.from([1, 2, 3]).buffer,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: 'chunk-over-bound',
            writeId: 'write-bounded',
            chunk: Uint8Array.from([4, 5]).buffer,
        });

        expect(write).toHaveBeenCalledOnce();
        expect(removeEntry).toHaveBeenCalledWith('.sourdaw-write-bounded.partial');
        expect(responses).toContainEqual({
            type: 'error',
            requestId: 'chunk-over-bound',
            name: 'Error',
            message: 'Model byte limit exceeded for model.onnx: expected at most 4 bytes',
        });
        await expectReplacementWriteCanAcquire({ locks: originLocks, root, writeId: 'write-bounded' });
    });

    it.each([
        [
            'throws',
            vi.fn(() => {
                throw new Error('write exploded');
            }),
            'write exploded',
        ],
        ['returns a short count', vi.fn(() => 1), 'OPFS wrote 1 of 3 model bytes'],
    ])('aborts and releases both leases when a chunk write %s', async (_case, write, message) => {
        const storage = createWriteStorage(write);
        const originLocks = new TestOriginLocks();
        const responses: ModelStorageWorkerResponse[] = [];
        const handler = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port(`terminal-${_case}`),
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'begin-model-write',
            requestId: `begin-${_case}`,
            writeId: `write-${_case}`,
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        await handler({
            type: 'write-model-chunk',
            requestId: `chunk-${_case}`,
            writeId: `write-${_case}`,
            chunk: Uint8Array.from([1, 2, 3]).buffer,
        });

        expect(storage.removeEntry).toHaveBeenCalledWith(`.sourdaw-write-${_case}.partial`);
        expect(responses).toContainEqual({
            type: 'error',
            requestId: `chunk-${_case}`,
            name: 'Error',
            message,
        });
        await expectReplacementWriteCanAcquire({
            locks: originLocks,
            root: storage.root,
            writeId: `write-${_case}`,
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

    it('deletes an oversized cached model before allocating or reading its declared bytes', async () => {
        const read = vi.fn();
        const syncAccess = readAccess(new Uint8Array(0));
        syncAccess.getSize = vi.fn(() => Number.MAX_SAFE_INTEGER);
        syncAccess.read = read;
        const oversizedFile = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(syncAccess)),
        } as unknown as FileSystemFileHandle;
        const retryBytes = Uint8Array.from([1, 2, 3, 4]);
        const retryAccess = readAccess(retryBytes);
        const retryFile = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(retryAccess)),
        } as unknown as FileSystemFileHandle;
        const removeEntry = vi.fn(() => Promise.resolve());
        const familyDirectory = {
            getFileHandle: vi.fn().mockResolvedValueOnce(oversizedFile).mockResolvedValueOnce(retryFile),
            removeEntry,
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const destinationPort = {
            postMessage: vi.fn(),
            close: vi.fn(),
        } as unknown as MessagePort;
        const responses: ModelStorageWorkerResponse[] = [];
        const sha256 = vi.fn((bytes: ArrayBuffer) =>
            Promise.resolve(
                new Uint8Array(bytes).every((byte, index) => byte === retryBytes[index]) ? 'verified' : 'wrong'
            )
        );
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256,
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'read-model',
            requestId: 'read-oversized',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 4,
            expectedSha256: 'verified',
            destinationPort,
        });

        expect(read).not.toHaveBeenCalled();
        expect(sha256).not.toHaveBeenCalled();
        expect(removeEntry).toHaveBeenCalledWith('model.onnx');
        expect(responses).toContainEqual({ type: 'read-complete', requestId: 'read-oversized', found: false });
        expect(syncAccess.close).toHaveBeenCalledOnce();

        const retryDestinationPort = {
            postMessage: vi.fn(),
            close: vi.fn(),
        } as unknown as MessagePort;
        await handler({
            type: 'read-model',
            requestId: 'read-retry',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: retryBytes.byteLength,
            expectedSha256: 'verified',
            destinationPort: retryDestinationPort,
        });

        expect(retryAccess.read).toHaveBeenCalled();
        expect(retryDestinationPort.postMessage).toHaveBeenCalledWith(
            { type: 'model-data', modelData: expect.any(ArrayBuffer) },
            [expect.any(ArrayBuffer)]
        );
        expect(responses).toContainEqual({ type: 'read-complete', requestId: 'read-retry', found: true });
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

    it('holds the model lock until invalid verification deletion finishes before a replacement commit', async () => {
        const events: string[] = [];
        const digest = deferred<string>();
        const oldFile = {
            kind: 'file',
            createSyncAccessHandle: vi.fn(() => {
                events.push('read-old');
                return Promise.resolve(readAccess(Uint8Array.from([1, 2, 3])));
            }),
        } as unknown as FileSystemFileHandle;
        const writeAccess = readAccess(new Uint8Array(0));
        writeAccess.write = vi.fn((input) => input.byteLength);
        let finalFile: FileSystemFileHandle | null = oldFile;
        let temporaryFile: FileSystemFileHandle | null = null;
        let temporaryName = '';
        const familyDirectory = {
            kind: 'directory',
            getFileHandle: vi.fn((name: string, options?: { create?: boolean }) => {
                if (name === 'model.onnx' && finalFile) {
                    return Promise.resolve(finalFile);
                }
                if (options?.create) {
                    events.push('create-partial');
                    temporaryName = name;
                    const created = {
                        kind: 'file',
                        createSyncAccessHandle: vi.fn(() => Promise.resolve(writeAccess)),
                        move: vi.fn(async (_directory: FileSystemDirectoryHandle, finalName: string) => {
                            events.push('move-new');
                            temporaryFile = null;
                            finalFile = created;
                            expect(finalName).toBe('model.onnx');
                        }),
                    } as unknown as FileSystemFileHandle;
                    temporaryFile = created;
                    return Promise.resolve(created);
                }
                return Promise.reject(new DOMException('missing', 'NotFoundError'));
            }),
            removeEntry: vi.fn(async (name: string) => {
                if (name === 'model.onnx') {
                    events.push('delete-old');
                    finalFile = null;
                    return;
                }
                if (name === temporaryName) {
                    temporaryFile = null;
                }
            }),
            async *[Symbol.asyncIterator]() {
                if (finalFile) {
                    yield ['model.onnx', finalFile] as const;
                }
                if (temporaryFile) {
                    yield [temporaryName, temporaryFile] as const;
                }
            },
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            kind: 'directory',
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
            async *[Symbol.asyncIterator]() {
                yield ['kokoro', familyDirectory] as const;
            },
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const originLocks = new TestOriginLocks();
        const verificationResponses: ModelStorageWorkerResponse[] = [];
        const verifier = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('verifier'),
            sha256: () => digest.promise,
            postResponse: (response) => verificationResponses.push(response),
        });
        const writer = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('writer'),
            postResponse: vi.fn(),
        });

        const verification = verifier({
            type: 'verify-model',
            requestId: 'verify-old',
            family: 'kokoro',
            modelId: 'model.onnx',
            expectedSizeBytes: 3,
            expectedSha256: 'verified',
        });
        await vi.waitFor(() => expect(events).toContain('read-old'));
        const begin = writer({
            type: 'begin-model-write',
            requestId: 'begin-new',
            writeId: 'write-new',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        let beginSettled = false;
        void begin.then(() => {
            beginSettled = true;
        });
        for (let index = 0; index < 10; index += 1) {
            await Promise.resolve();
        }
        expect(beginSettled).toBe(false);
        expect(events).not.toContain('create-partial');

        digest.resolve('wrong');
        await verification;
        await begin;
        await writer({
            type: 'write-model-chunk',
            requestId: 'chunk-new',
            writeId: 'write-new',
            chunk: Uint8Array.from([4, 5, 6]).buffer,
        });
        await writer({ type: 'commit-model-write', requestId: 'commit-new', writeId: 'write-new' });

        expect(events).toEqual(['read-old', 'delete-old', 'create-partial', 'move-new']);
        expect(finalFile).not.toBeNull();
        expect(verificationResponses).toContainEqual({
            type: 'model-verified',
            requestId: 'verify-old',
            verified: false,
        });
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
        const sha256 = vi.fn((bytes: ArrayBuffer) =>
            Promise.resolve(
                new Uint8Array(bytes).every((byte, index) => byte === archiveBytes[index]) ? 'verified' : 'wrong'
            )
        );
        const handler = createModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            sha256,
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
        expect(new Uint8Array(sha256.mock.calls[0]?.[0] ?? new ArrayBuffer(0))).toEqual(archiveBytes);
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
        const originLocks = new TestOriginLocks();
        const handler = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('explicit-abort-writer'),
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
        await expectReplacementWriteCanAcquire({ locks: originLocks, root, writeId: 'write-abort' });
    });

    it('lets a queued writer publish after the previous worker aborts without losing the replacement', async () => {
        const storage = createWriteStorage(vi.fn((input: ArrayBufferView) => input.byteLength));
        const originLocks = new TestOriginLocks();
        const firstResponses: ModelStorageWorkerResponse[] = [];
        const secondResponses: ModelStorageWorkerResponse[] = [];
        const first = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('cancelled-worker'),
            postResponse: (response) => firstResponses.push(response),
        });
        const second = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('replacement-worker'),
            postResponse: (response) => secondResponses.push(response),
        });

        await first({
            type: 'begin-model-write',
            requestId: 'begin-cancelled',
            writeId: 'write-cancelled',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        const replacementBegin = second({
            type: 'begin-model-write',
            requestId: 'begin-replacement',
            writeId: 'write-replacement',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        let replacementBegan = false;
        void replacementBegin.then(() => {
            replacementBegan = true;
        });
        for (let index = 0; index < 10; index += 1) {
            await Promise.resolve();
        }
        expect(replacementBegan).toBe(false);

        await first({ type: 'abort-model-write', requestId: 'abort-cancelled', writeId: 'write-cancelled' });
        await replacementBegin;
        await second({
            type: 'write-model-chunk',
            requestId: 'chunk-replacement',
            writeId: 'write-replacement',
            chunk: Uint8Array.from([4, 5, 6]).buffer,
        });
        await second({
            type: 'commit-model-write',
            requestId: 'commit-replacement',
            writeId: 'write-replacement',
        });

        expect(firstResponses).toContainEqual({ type: 'write-aborted', requestId: 'abort-cancelled' });
        expect(storage.move).toHaveBeenCalledWith(expect.anything(), 'model.onnx');
        expect(secondResponses).toContainEqual({
            type: 'write-committed',
            requestId: 'commit-replacement',
            storedBytes: 3,
            extractedPath: null,
        });
    });

    it('serializes aliases that resolve to the same nested OPFS model path', async () => {
        const secondReachedStorage = deferred<void>();
        const files = new Map<string, FileSystemFileHandle>();
        const directory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(directory)),
            getFileHandle: vi.fn((name: string) => {
                if (name === '.sourdaw-write-alias-b.partial') {
                    secondReachedStorage.resolve();
                }
                const existing = files.get(name);
                if (existing) {
                    return Promise.resolve(existing);
                }
                const access = readAccess(new Uint8Array(0));
                access.write = vi.fn((input) => input.byteLength);
                const file = {
                    createSyncAccessHandle: vi.fn(() => Promise.resolve(access)),
                    move: vi.fn(() => Promise.resolve()),
                } as unknown as FileSystemFileHandle;
                files.set(name, file);
                return Promise.resolve(file);
            }),
            removeEntry: vi.fn((name: string) => {
                files.delete(name);
                return Promise.resolve();
            }),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(directory)),
        } as unknown as FileSystemDirectoryHandle;
        const originLocks = new TestOriginLocks();
        const first = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('alias-a'),
            postResponse: vi.fn(),
        });
        const second = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('alias-b'),
            postResponse: vi.fn(),
        });

        await first({
            type: 'begin-model-write',
            requestId: 'begin-alias-a',
            writeId: 'write-alias-a',
            family: 'voice/cloned',
            modelId: 'user/model',
            archive: false,
        });
        const secondBegin = second({
            type: 'begin-model-write',
            requestId: 'begin-alias-b',
            writeId: 'write-alias-b',
            family: 'voice',
            modelId: 'cloned/user/model',
            archive: false,
        });
        let secondReachedPath = false;
        void secondReachedStorage.promise.then(() => {
            secondReachedPath = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(secondReachedPath).toBe(false);

        await first({ type: 'abort-model-write', requestId: 'abort-alias-a', writeId: 'write-alias-a' });
        await secondBegin;
        expect(secondReachedPath).toBe(true);
        await second({ type: 'abort-model-write', requestId: 'abort-alias-b', writeId: 'write-alias-b' });
    });

    it('holds the model lease until an aborted in-flight move settles before admitting a replacement', async () => {
        const moveStarted = deferred<void>();
        const finishMove = deferred<void>();
        let finalOwner: 'cancelled' | 'replacement' | null = null;
        const access = () => {
            const syncAccess = readAccess(new Uint8Array(0));
            syncAccess.write = vi.fn((input) => input.byteLength);
            return syncAccess;
        };
        const cancelledFile = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(access())),
            move: vi.fn(async () => {
                moveStarted.resolve();
                await finishMove.promise;
                finalOwner = 'cancelled';
            }),
        } as unknown as FileSystemFileHandle;
        const replacementFile = {
            createSyncAccessHandle: vi.fn(() => Promise.resolve(access())),
            move: vi.fn(() => {
                finalOwner = 'replacement';
                return Promise.resolve();
            }),
        } as unknown as FileSystemFileHandle;
        const replacementReachedStorage = deferred<void>();
        const familyDirectory = {
            getFileHandle: vi.fn((name: string) => {
                if (name === '.sourdaw-write-cancelled-move.partial') {
                    return Promise.resolve(cancelledFile);
                }
                if (name === '.sourdaw-write-after-move.partial') {
                    replacementReachedStorage.resolve();
                    return Promise.resolve(replacementFile);
                }
                return Promise.reject(new DOMException('missing', 'NotFoundError'));
            }),
            removeEntry: vi.fn((name: string) => {
                if (name === 'model.onnx') {
                    finalOwner = null;
                }
                return Promise.resolve();
            }),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const originLocks = new TestOriginLocks();
        const cancelledResponses: ModelStorageWorkerResponse[] = [];
        const replacementResponses: ModelStorageWorkerResponse[] = [];
        const cancelled = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('cancelled-move-worker'),
            postResponse: (response) => cancelledResponses.push(response),
        });
        const replacement = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(root),
            locks: originLocks.port('replacement-after-move-worker'),
            postResponse: (response) => replacementResponses.push(response),
        });

        await cancelled({
            type: 'begin-model-write',
            requestId: 'begin-cancelled-move',
            writeId: 'write-cancelled-move',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        await cancelled({
            type: 'write-model-chunk',
            requestId: 'chunk-cancelled-move',
            writeId: 'write-cancelled-move',
            chunk: Uint8Array.from([1, 2, 3]).buffer,
        });
        const commit = cancelled({
            type: 'commit-model-write',
            requestId: 'commit-cancelled-move',
            writeId: 'write-cancelled-move',
        });
        await moveStarted.promise;
        const abort = cancelled({
            type: 'abort-model-write',
            requestId: 'abort-cancelled-move',
            writeId: 'write-cancelled-move',
        });
        const replacementBegin = replacement({
            type: 'begin-model-write',
            requestId: 'begin-after-move',
            writeId: 'write-after-move',
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        let replacementReachedPath = false;
        void replacementReachedStorage.promise.then(() => {
            replacementReachedPath = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(replacementReachedPath).toBe(false);

        finishMove.resolve();
        await Promise.all([commit, abort, replacementBegin]);
        await replacement({
            type: 'write-model-chunk',
            requestId: 'chunk-after-move',
            writeId: 'write-after-move',
            chunk: Uint8Array.from([4, 5, 6]).buffer,
        });
        await replacement({
            type: 'commit-model-write',
            requestId: 'commit-after-move',
            writeId: 'write-after-move',
        });

        expect(finalOwner).toBe('replacement');
        expect(cancelledResponses).not.toContainEqual(expect.objectContaining({ type: 'write-committed' }));
        expect(cancelledResponses).toContainEqual({
            type: 'error',
            requestId: 'commit-cancelled-move',
            name: 'AbortError',
            message: 'Aborted',
        });
        expect(cancelledResponses).toContainEqual({ type: 'write-aborted', requestId: 'abort-cancelled-move' });
        expect(replacementResponses).toContainEqual({
            type: 'write-committed',
            requestId: 'commit-after-move',
            storedBytes: 3,
            extractedPath: null,
        });
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

    it('reports a cache hit when the model file already exists in OPFS', async () => {
        const fileHandle = {} as unknown as FileSystemFileHandle;
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
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
            postResponse: (response) => responses.push(response),
        });

        await handler({
            type: 'check-model',
            requestId: 'check-hit',
            family: 'kokoro',
            modelId: 'model.onnx',
        });

        expect(familyDirectory.getFileHandle).toHaveBeenCalledWith('model.onnx', { create: false });
        expect(responses).toContainEqual({
            type: 'model-checked',
            requestId: 'check-hit',
            cached: true,
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

        expect(getDirectoryHandle.mock.calls.map(([name]) => name)).toEqual(['models', 'models', 'renders']);
        expect(responses).toContainEqual({
            type: 'storage-measured',
            requestId: 'measure-1',
            usedBytes: 120,
        });
    });

    it("does not scavenge another worker context's active partial", async () => {
        const activeWriteId = 'write-active';
        const activeTemporaryName = `.sourdaw-${activeWriteId}.partial`;
        const storage = createMutableStorageTree();
        const originLocks = new TestOriginLocks();
        const writerResponses: ModelStorageWorkerResponse[] = [];
        const observerResponses: ModelStorageWorkerResponse[] = [];
        const writer = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('writer-worker'),
            postResponse: (response) => writerResponses.push(response),
        });
        const observer = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('observer-worker'),
            postResponse: (response) => observerResponses.push(response),
        });

        await writer({
            type: 'begin-model-write',
            requestId: 'begin-active',
            writeId: activeWriteId,
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        storage.removeEntry.mockClear();
        await observer({ type: 'measure-storage', requestId: 'measure-partials' });

        expect(storage.files.has(activeTemporaryName)).toBe(true);
        expect(storage.removeEntry).not.toHaveBeenCalledWith(activeTemporaryName);
        expect(observerResponses).toContainEqual({
            type: 'storage-measured',
            requestId: 'measure-partials',
            usedBytes: 120,
        });
    });

    it('scavenges a crashed worker partial after its origin-wide lease resets', async () => {
        const crashedWriteId = 'write-crashed';
        const crashedTemporaryName = `.sourdaw-${crashedWriteId}.partial`;
        const storage = createMutableStorageTree();
        const originLocks = new TestOriginLocks();
        const crashedWorker = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('crashed-worker'),
            postResponse: vi.fn(),
        });
        const restartedResponses: ModelStorageWorkerResponse[] = [];

        await crashedWorker({
            type: 'begin-model-write',
            requestId: 'begin-crashed',
            writeId: crashedWriteId,
            family: 'kokoro',
            modelId: 'model.onnx',
            archive: false,
        });
        await originLocks.crash('crashed-worker');

        const restartedWorker = createRuntimeModelStorageRequestHandler({
            getRoot: () => Promise.resolve(storage.root),
            locks: originLocks.port('restarted-worker'),
            postResponse: (response) => restartedResponses.push(response),
        });
        await restartedWorker({ type: 'measure-storage', requestId: 'measure-after-crash' });

        expect(storage.removeEntry).toHaveBeenCalledWith(crashedTemporaryName);
        expect(storage.files.has(crashedTemporaryName)).toBe(false);
        expect(restartedResponses).toContainEqual({
            type: 'storage-measured',
            requestId: 'measure-after-crash',
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
