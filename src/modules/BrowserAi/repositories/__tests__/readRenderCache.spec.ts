import { afterEach, describe, expect, it, vi } from 'vitest';

import { readRenderCache } from '../readRenderCache';

import { dir, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('readRenderCache', () => {
    it('returns the cached audio samples when the render cache entry exists', async () => {
        const cached = new Float32Array([0.25, -0.5, 1]);
        const file = { arrayBuffer: vi.fn(() => Promise.resolve(cached.buffer)) } as unknown as File;
        const fileHandle = { getFile: vi.fn(() => Promise.resolve(file)) } as unknown as FileSystemFileHandle;
        const cacheDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(cacheDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(root)) as unknown as StorageManager['getDirectory'],
        });

        const result = await readRenderCache({ cacheKey: 'phrase' });

        expect(result).toEqual(cached);
    });

    it('returns null when the render cache entry is missing', async () => {
        installStorage(dir());

        const result = await readRenderCache({ cacheKey: 'missing' });

        expect(result).toBeNull();
    });
});
