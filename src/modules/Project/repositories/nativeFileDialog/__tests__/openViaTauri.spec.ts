import { beforeEach, describe, expect, it, vi } from 'vitest';

import { open } from '@tauri-apps/plugin-dialog';

import { openViaBrowser } from '../helpers';
import { openViaTauri } from '../openViaTauri';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

vi.mock('../helpers', () => ({
    openViaBrowser: vi.fn(),
}));

describe('openViaTauri', () => {
    beforeEach(() => {
        vi.mocked(open).mockReset();
        vi.mocked(openViaBrowser).mockReset();
    });

    it('should return null when native dialog is cancelled', async () => {
        const filters = [{ name: 'Audio', extensions: ['wav'] }];
        vi.mocked(open).mockResolvedValue(null);

        const result = await openViaTauri({ multiple: true, filters });

        expect(result).toBeNull();
        expect(open).toHaveBeenCalledWith({
            multiple: true,
            filters,
        });
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should normalize a single native path to a one-item array', async () => {
        vi.mocked(open).mockResolvedValue('/path/kick.wav');

        const result = await openViaTauri({ multiple: false });

        expect(result).toEqual(['/path/kick.wav']);
        expect(open).toHaveBeenCalledWith({
            multiple: false,
            filters: undefined,
        });
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should pass native path arrays through unchanged', async () => {
        const paths = ['/path/kick.wav', '/path/snare.wav'];
        vi.mocked(open).mockResolvedValue(paths);

        const result = await openViaTauri({ multiple: true });

        expect(result).toBe(paths);
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should fall back to browser selection when the native dialog call throws', async () => {
        const filters = [{ name: 'Audio', extensions: ['wav', 'mp3'] }];
        const options = { multiple: true, filters };
        vi.mocked(open).mockRejectedValue(new Error('native dialog unavailable'));
        vi.mocked(openViaBrowser).mockResolvedValue(['fallback.wav']);

        const result = await openViaTauri(options);

        expect(result).toEqual(['fallback.wav']);
        expect(openViaBrowser).toHaveBeenCalledWith(options);
    });
});
