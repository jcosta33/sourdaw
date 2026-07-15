import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeRenderCache } from '../writeRenderCache';

import { dir, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
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
