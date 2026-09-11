import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSaveDialog } from '#/utils/desktopBridge';

import { saveViaNative } from '../saveViaNative';

vi.mock('#/utils/desktopBridge', () => ({
    desktopSaveDialog: vi.fn(),
}));

describe('saveViaNative', () => {
    beforeEach(() => {
        vi.mocked(desktopSaveDialog).mockReset();
    });

    it('S1 forwards filters and basename-stripped suggestedName', async () => {
        const filters = [{ name: 'Audio', extensions: ['wav'] }];
        vi.mocked(desktopSaveDialog).mockResolvedValue('/exports/passwd');

        await saveViaNative({ filters, suggestedName: '/etc/passwd' });

        expect(desktopSaveDialog).toHaveBeenCalledWith({
            defaultPath: 'passwd',
            filters,
        });
    });

    it('S2 returns null when the bridge returns null', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue(null);

        const result = await saveViaNative({ suggestedName: 'mix.wav' });

        expect(result).toBeNull();
    });

    it('S3 returns the path the bridge returns unchanged', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue('/exports/mix.wav');

        const result = await saveViaNative({ suggestedName: 'mix.wav' });

        expect(result).toBe('/exports/mix.wav');
        expect(desktopSaveDialog).toHaveBeenCalledWith({
            defaultPath: 'mix.wav',
            filters: undefined,
        });
    });

    it('leaves suggestedName undefined when not supplied', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue(null);

        await saveViaNative({});

        expect(desktopSaveDialog).toHaveBeenCalledWith({
            defaultPath: undefined,
            filters: undefined,
        });
    });
});
