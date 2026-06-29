import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { readTauriDirectory } from '../readTauriDirectory';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('readTauriDirectory', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should forward the absolute path to the native directory reader', async () => {
        vi.mocked(invoke).mockResolvedValue([
            { name: 'Drums', path: '/Users/jose/Samples/Drums', is_directory: true, size_bytes: 0 },
            { name: 'kick.wav', path: '/Users/jose/Samples/kick.wav', is_directory: false, size_bytes: 12 },
        ]);

        const entries = await readTauriDirectory({ path: '/Users/jose/Samples' });

        expect(invoke).toHaveBeenCalledWith('list_directory', { path: '/Users/jose/Samples' });
        expect(entries).toEqual([
            { name: 'Drums', isDirectory: true },
            { name: 'kick.wav', isDirectory: false },
        ]);
    });
});
