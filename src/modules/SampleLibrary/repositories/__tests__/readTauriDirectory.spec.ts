import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readDir } from '@tauri-apps/plugin-fs';

import { readTauriDirectory } from '../readTauriDirectory';

vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: vi.fn(),
}));

describe('readTauriDirectory', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should forward the absolute path to the native directory reader', async () => {
        vi.mocked(readDir).mockResolvedValue([
            { name: 'Drums', isDirectory: true, isFile: false, isSymlink: false },
            { name: 'kick.wav', isDirectory: false, isFile: true, isSymlink: false },
        ]);

        const entries = await readTauriDirectory({ path: '/Users/jose/Samples' });

        expect(readDir).toHaveBeenCalledWith('/Users/jose/Samples');
        expect(entries).toEqual([
            { name: 'Drums', isDirectory: true },
            { name: 'kick.wav', isDirectory: false },
        ]);
    });
});
