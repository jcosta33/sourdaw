import { afterEach, describe, expect, it, vi } from 'vitest';

import { getStorageStatus } from '../getStorageStatus';

import { dir, file, installStorage } from './storageTestDoubles';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getStorageStatus', () => {
    it('measures only BrowserAi model and render directories', async () => {
        installStorage(
            dir({
                models: dir({ ddsp: dir({ 'violin.onnx': file(100) }) }),
                renders: dir({ 'cache-a.pcm': file(20) }),
                projects: dir({ 'song.daw': file(1_000_000) }),
                arrangementCache: file(500_000),
            })
        );

        await expect(getStorageStatus()).resolves.toMatchObject({ usedBytes: 120 });
    });

    it('reports zero when both owned directories are absent', async () => {
        installStorage(dir({ projects: dir({ 'song.daw': file(999) }) }));

        await expect(getStorageStatus()).resolves.toMatchObject({ usedBytes: 0 });
    });

    it('falls back to zero used bytes when measuring storage throws', async () => {
        installStorage(dir(), {
            getDirectory: vi.fn(() =>
                Promise.reject(new Error('opfs unavailable'))
            ) as unknown as StorageManager['getDirectory'],
        });

        await expect(getStorageStatus()).resolves.toMatchObject({ usedBytes: 0, persisted: false });
    });
});
