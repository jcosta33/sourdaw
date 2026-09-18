import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { readNativeDirectory } from '../readNativeDirectory';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

describe('readNativeDirectory', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should forward the absolute path to the native directory reader', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue([
            { name: 'Drums', path: '/Users/jose/Samples/Drums', is_directory: true, size_bytes: 0 },
            { name: 'kick.wav', path: '/Users/jose/Samples/kick.wav', is_directory: false, size_bytes: 12 },
        ]);

        const entries = await readNativeDirectory({ path: '/Users/jose/Samples' });

        expect(desktopInvoke).toHaveBeenCalledWith('list_directory', { path: '/Users/jose/Samples' });
        expect(entries).toEqual([
            { name: 'Drums', isDirectory: true },
            { name: 'kick.wav', isDirectory: false },
        ]);
    });
});
