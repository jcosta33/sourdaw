/**
 * Regression tests for the OPFS storage manager.
 *
 * Covers two correctness bugs:
 *  - getStorageStatus must measure only the models/ and renders/ subdirectories,
 *    never the whole OPFS root (other modules' bytes must not count against the
 *    BrowserAi cache budget).
 *  - checkModelCached must distinguish a genuine NotFoundError (true miss → false)
 *    from a permission / corrupt-OPFS / transient-IO error (must surface, not be
 *    collapsed into "not cached").
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkModelCached } from '../checkModelCached';
import { createModelWritable } from '../createModelWritable';
import { deleteModel } from '../deleteModel';
import { getStorageStatus } from '../getStorageStatus';
import { writeModel } from '../writeModel';
import { writeRenderCache } from '../writeRenderCache';

vi.mock('../createModelWritable', () => ({
    createModelWritable: vi.fn(),
}));

type FakeFile = { kind: 'file'; size: number };
type FakeDir = {
    kind: 'directory';
    entries: Map<string, FakeFile | FakeDir>;
};

function file(size: number): FakeFile {
    return { kind: 'file', size };
}

function dir(entries: Record<string, FakeFile | FakeDir> = {}): FakeDir {
    return { kind: 'directory', entries: new Map(Object.entries(entries)) };
}

function notFound(): DOMException {
    return new DOMException('not found', 'NotFoundError');
}

/**
 * Wrap a fake directory tree as a minimal FileSystemDirectoryHandle: supports
 * getDirectoryHandle, getFileHandle, and async iteration of [name, handle] pairs.
 */
function fileHandleFor(size: number): FileSystemFileHandle {
    return {
        kind: 'file',
        getFile(): Promise<{ size: number }> {
            return Promise.resolve({ size });
        },
    } as unknown as FileSystemFileHandle;
}

function asHandle(node: FakeDir): FileSystemDirectoryHandle {
    const handle = {
        kind: 'directory' as const,
        getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
            const existing = node.entries.get(name);
            if (existing && existing.kind === 'directory') {
                return Promise.resolve(asHandle(existing));
            }
            if (opts?.create) {
                const created = dir();
                node.entries.set(name, created);
                return Promise.resolve(asHandle(created));
            }
            return Promise.reject(notFound());
        },
        getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
            const existing = node.entries.get(name);
            if (existing && existing.kind === 'file') {
                return Promise.resolve(fileHandleFor(existing.size));
            }
            if (opts?.create) {
                const created = file(0);
                node.entries.set(name, created);
                return Promise.resolve(fileHandleFor(0));
            }
            return Promise.reject(notFound());
        },
        async *[Symbol.asyncIterator](): AsyncIterableIterator<
            [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        > {
            await Promise.resolve();
            for (const [name, child] of node.entries) {
                if (child.kind === 'file') {
                    yield [name, fileHandleFor(child.size)];
                } else {
                    yield [name, asHandle(child)];
                }
            }
        },
    };
    return handle as unknown as FileSystemDirectoryHandle;
}

function installStorage(root: FakeDir, overrides?: Partial<StorageManager>): void {
    Object.defineProperty(globalThis.navigator, 'storage', {
        configurable: true,
        value: {
            getDirectory: vi.fn(() => Promise.resolve(asHandle(root))),
            estimate: vi.fn(() => Promise.resolve({ quota: 0, usage: 0 })),
            persisted: vi.fn(() => Promise.resolve(false)),
            persist: vi.fn(() => Promise.resolve(false)),
            ...overrides,
        } as unknown as StorageManager,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createModelWritable).mockReset();
});

describe('getStorageStatus', () => {
    it('measures only the models/ and renders/ subdirectories, not the whole OPFS root', async () => {
        const root = dir({
            models: dir({ ddsp: dir({ 'violin.onnx': file(100) }) }),
            renders: dir({ 'cache-a.pcm': file(20) }),
            // Bytes owned by other modules must NOT count against the BrowserAi budget.
            projects: dir({ 'song.daw': file(1_000_000) }),
            arrangementCache: file(500_000),
        });
        installStorage(root);

        const status = await getStorageStatus();

        // 100 (model) + 20 (render) only — the 1.5 MB of foreign bytes are excluded.
        expect(status.usedBytes).toBe(120);
    });

    it('reports zero when the models/ and renders/ directories are absent', async () => {
        const root = dir({ projects: dir({ 'song.daw': file(999) }) });
        installStorage(root);

        const status = await getStorageStatus();

        expect(status.usedBytes).toBe(0);
    });
});

describe('checkModelCached', () => {
    it('returns true when the model file exists', async () => {
        const root = dir({ models: dir({ ddsp: dir({ violin: file(10) }) }) });
        installStorage(root);

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).resolves.toBe(true);
    });

    it('returns false on a genuine NotFoundError (true cache miss)', async () => {
        const root = dir({ models: dir({ ddsp: dir() }) });
        installStorage(root);

        await expect(checkModelCached({ family: 'ddsp', modelId: 'absent' })).resolves.toBe(false);
    });

    it('returns false when the models/ directory does not exist yet', async () => {
        const root = dir({});
        installStorage(root);

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).resolves.toBe(false);
    });

    it('rethrows a non-NotFound error instead of collapsing it into "not cached"', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        installStorage(dir({}), {
            getDirectory: vi.fn(() => Promise.reject(permissionError)) as unknown as StorageManager['getDirectory'],
        });

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
    });

    it('rethrows a non-NotFound error raised while resolving the models/ directory', async () => {
        const ioError = new DOMException('io', 'InvalidStateError');
        const root = dir({});
        // Make getDirectoryHandle('models') throw a transient IO error rather than NotFound.
        const rootHandle = asHandle(root) as unknown as {
            getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<unknown>;
        };
        rootHandle.getDirectoryHandle = vi.fn(() => Promise.reject(ioError));
        Object.defineProperty(globalThis.navigator, 'storage', {
            configurable: true,
            value: {
                getDirectory: vi.fn(() => Promise.resolve(rootHandle)),
            } as unknown as StorageManager,
        });

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(ioError);
    });
});

describe('deleteModel', () => {
    it('traverses nested family directories before deleting the model file', async () => {
        const removeEntry = vi.fn(() => Promise.resolve());
        const vocoderDirectory = { removeEntry } as unknown as FileSystemDirectoryHandle;
        const diffsingerDirectory = {
            getDirectoryHandle: vi.fn((name: string) => {
                if (name === 'vocoder') {
                    return Promise.resolve(vocoderDirectory);
                }
                return Promise.reject(notFound());
            }),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn((name: string) => {
                if (name === 'diffsinger') {
                    return Promise.resolve(diffsingerDirectory);
                }
                return Promise.reject(notFound());
            }),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn((name: string) => {
                if (name === 'models') {
                    return Promise.resolve(modelsDirectory);
                }
                return Promise.reject(notFound());
            }),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(root)) as unknown as StorageManager['getDirectory'],
        });

        await deleteModel({ family: 'diffsinger/vocoder', modelId: 'nsf-hifigan-44k' });

        expect(removeEntry).toHaveBeenCalledWith('nsf-hifigan-44k');
    });
});

describe('writeModel', () => {
    it('aborts the writable when writing fails', async () => {
        const writeError = new Error('write failed');
        const writable = {
            write: vi.fn(() => Promise.reject(writeError)),
            close: vi.fn(() => Promise.resolve()),
            abort: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemWritableFileStream;
        vi.mocked(createModelWritable).mockResolvedValue(writable);

        await expect(writeModel({ family: 'ddsp', modelId: 'violin', data: new ArrayBuffer(4) })).rejects.toBe(
            writeError
        );

        expect(writable.abort).toHaveBeenCalledOnce();
    });
});

describe('writeRenderCache', () => {
    it('aborts the writable when closing the cache file fails', async () => {
        const closeError = new Error('close failed');
        const writable = {
            write: vi.fn(() => Promise.resolve()),
            close: vi.fn(() => Promise.reject(closeError)),
            abort: vi.fn(() => Promise.resolve()),
        } as unknown as FileSystemWritableFileStream;
        const fileHandle = {
            createWritable: vi.fn(() => Promise.resolve(writable)),
        } as unknown as FileSystemFileHandle;
        const cacheDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(cacheDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(root)) as unknown as StorageManager['getDirectory'],
        });

        await writeRenderCache({ cacheKey: 'phrase', audio: new Float32Array([0.5]) });

        expect(writable.abort).toHaveBeenCalledOnce();
    });
});
