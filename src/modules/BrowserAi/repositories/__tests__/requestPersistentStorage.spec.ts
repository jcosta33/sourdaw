import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestPersistentStorage } from '../requestPersistentStorage';

import { dir, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('requestPersistentStorage', () => {
    it('returns true when the browser grants persistent storage', async () => {
        installStorage(dir(), { persist: vi.fn(() => Promise.resolve(true)) });

        await expect(requestPersistentStorage()).resolves.toBe(true);
    });

    it('returns false when the browser denies persistent storage', async () => {
        installStorage(dir(), { persist: vi.fn(() => Promise.resolve(false)) });

        await expect(requestPersistentStorage()).resolves.toBe(false);
    });

    it('returns false when the persist call throws', async () => {
        installStorage(dir(), { persist: vi.fn(() => Promise.reject(new Error('denied'))) });

        await expect(requestPersistentStorage()).resolves.toBe(false);
    });
});
