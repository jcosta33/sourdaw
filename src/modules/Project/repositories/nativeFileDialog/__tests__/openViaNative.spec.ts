import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopOpenDialog } from '#/utils/desktopBridge';

import { openViaBrowser } from '../helpers';
import { openViaNative } from '../openViaNative';

vi.mock('#/utils/desktopBridge', () => ({
    desktopOpenDialog: vi.fn(),
}));

vi.mock('../helpers', () => ({
    openViaBrowser: vi.fn(),
}));

describe('openViaNative', () => {
    beforeEach(() => {
        vi.mocked(desktopOpenDialog).mockReset();
        vi.mocked(openViaBrowser).mockReset();
    });

    it('should return null when native dialog is cancelled', async () => {
        const filters = [{ name: 'Audio', extensions: ['wav'] }];
        vi.mocked(desktopOpenDialog).mockResolvedValue(null);

        const result = await openViaNative({ multiple: true, filters });

        expect(result).toBeNull();
        expect(desktopOpenDialog).toHaveBeenCalledWith({
            multiple: true,
            filters,
        });
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should normalize a single native path to a one-item array', async () => {
        vi.mocked(desktopOpenDialog).mockResolvedValue('/path/kick.wav');

        const result = await openViaNative({ multiple: false });

        expect(result).toEqual(['/path/kick.wav']);
        expect(desktopOpenDialog).toHaveBeenCalledWith({
            multiple: false,
            filters: undefined,
        });
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should pass native path arrays through unchanged', async () => {
        const paths = ['/path/kick.wav', '/path/snare.wav'];
        vi.mocked(desktopOpenDialog).mockResolvedValue(paths);

        const result = await openViaNative({ multiple: true });

        expect(result).toBe(paths);
        expect(openViaBrowser).not.toHaveBeenCalled();
    });

    it('should fall back to browser selection when the native dialog call throws', async () => {
        const filters = [{ name: 'Audio', extensions: ['wav', 'mp3'] }];
        const options = { multiple: true, filters };
        vi.mocked(desktopOpenDialog).mockRejectedValue(new Error('native dialog unavailable'));
        vi.mocked(openViaBrowser).mockResolvedValue(['fallback.wav']);

        const result = await openViaNative(options);

        expect(result).toEqual(['fallback.wav']);
        expect(openViaBrowser).toHaveBeenCalledWith(options);
    });
});
