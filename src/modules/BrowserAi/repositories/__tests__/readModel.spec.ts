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
});
