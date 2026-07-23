import { afterEach, describe, expect, it, vi } from 'vitest';

import { readModel } from '../readModel';

import { dir, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('readModel', () => {
    it('returns null when the model file is absent', async () => {
        installStorage(dir({ models: dir({ ddsp: dir() }) }));

        await expect(readModel({ family: 'ddsp', modelId: 'missing' })).resolves.toBeNull();
    });

    it('rethrows non-not-found storage failures', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.reject(permissionError)) as unknown as StorageManager['getDirectory'],
        });

        await expect(readModel({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
    });

    it('returns the model bytes when the file is present', async () => {
        const buffer = new ArrayBuffer(4);
        const fileHandle = {
            getFile: vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(buffer) } as unknown as File)),
        } as unknown as FileSystemFileHandle;
        const familyDirectory = {
            getFileHandle: vi.fn(() => Promise.resolve(fileHandle)),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(root)) as unknown as StorageManager['getDirectory'],
        });

        await expect(readModel({ family: 'ddsp', modelId: 'violin.onnx' })).resolves.toBe(buffer);
    });
});
