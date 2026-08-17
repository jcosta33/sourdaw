import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteModel } from '../deleteModel';

import { dir, installStorage, notFound } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('deleteModel', () => {
    it('traverses nested family directories before deleting the model file', async () => {
        const removeEntry = vi.fn(() => Promise.resolve());
        const vocoderDirectory = { removeEntry } as unknown as FileSystemDirectoryHandle;
        const diffsingerDirectory = {
            getDirectoryHandle: vi.fn((name: string) =>
                name === 'vocoder' ? Promise.resolve(vocoderDirectory) : Promise.reject(notFound())
            ),
        } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn((name: string) =>
                name === 'diffsinger' ? Promise.resolve(diffsingerDirectory) : Promise.reject(notFound())
            ),
        } as unknown as FileSystemDirectoryHandle;
        const root = {
            getDirectoryHandle: vi.fn((name: string) =>
                name === 'models' ? Promise.resolve(modelsDirectory) : Promise.reject(notFound())
            ),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(root)) as unknown as StorageManager['getDirectory'],
        });

        await deleteModel({ family: 'diffsinger/vocoder', modelId: 'test-vocoder' });

        expect(removeEntry).toHaveBeenCalledWith('test-vocoder');
    });

    it('rethrows a storage failure so callers do not clear registry state', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.reject(permissionError)) as unknown as StorageManager['getDirectory'],
        });

        await expect(deleteModel({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
    });

    it('resolves silently when the model file is already gone', async () => {
        const removeEntry = vi.fn(() => Promise.reject(notFound()));
        const familyDirectory = { removeEntry } as unknown as FileSystemDirectoryHandle;
        const modelsDirectory = {
            getDirectoryHandle: vi.fn(() => Promise.resolve(familyDirectory)),
        } as unknown as FileSystemDirectoryHandle;
        installStorage(dir(), {
            getDirectory: vi.fn(() =>
                Promise.resolve({
                    getDirectoryHandle: vi.fn(() => Promise.resolve(modelsDirectory)),
                })
            ) as unknown as StorageManager['getDirectory'],
        });

        await expect(deleteModel({ family: 'ddsp', modelId: 'violin' })).resolves.toBeUndefined();
        expect(removeEntry).toHaveBeenCalledWith('violin');
    });
});
