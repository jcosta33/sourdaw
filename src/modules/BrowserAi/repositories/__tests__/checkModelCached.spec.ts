import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkModelCached } from '../checkModelCached';

import { asHandle, dir, file, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('checkModelCached', () => {
    it('returns true when the model file exists', async () => {
        installStorage(dir({ models: dir({ ddsp: dir({ violin: file(10) }) }) }));

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).resolves.toBe(true);
    });

    it('returns false when the model file is absent', async () => {
        installStorage(dir({ models: dir({ ddsp: dir() }) }));

        await expect(checkModelCached({ family: 'ddsp', modelId: 'absent' })).resolves.toBe(false);
    });

    it('returns false when the models directory is absent', async () => {
        installStorage(dir());

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).resolves.toBe(false);
    });

    it('rethrows a storage-root permission error', async () => {
        const permissionError = new DOMException('denied', 'NotAllowedError');
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.reject(permissionError)) as unknown as StorageManager['getDirectory'],
        });

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(permissionError);
    });

    it('rethrows an IO error while resolving the models directory', async () => {
        const ioError = new DOMException('io', 'InvalidStateError');
        const rootHandle = asHandle(dir()) as unknown as {
            getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<unknown>;
        };
        rootHandle.getDirectoryHandle = vi.fn(() => Promise.reject(ioError));
        installStorage(dir(), {
            getDirectory: vi.fn(() => Promise.resolve(rootHandle)) as unknown as StorageManager['getDirectory'],
        });

        await expect(checkModelCached({ family: 'ddsp', modelId: 'violin' })).rejects.toBe(ioError);
    });

    it('returns false when a nested family segment is absent', async () => {
        installStorage(dir({ models: dir({ diffsinger: dir({ linguistic: dir() }) }) }));

        const result = await checkModelCached({ family: 'diffsinger/vocoder', modelId: 'test-vocoder' });
        expect(result).toBe(false);
    });
});
