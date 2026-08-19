import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopOpenDialog } from '#/utils/desktopBridge';

import { selectNativeAudioExportDirectory } from '../selectNativeAudioExportDirectory';

vi.mock('#/utils/desktopBridge', () => ({
    desktopOpenDialog: vi.fn(),
}));

describe('selectNativeAudioExportDirectory', () => {
    beforeEach(() => {
        vi.mocked(desktopOpenDialog).mockReset();
    });

    it('should return null when native directory selection is cancelled', async () => {
        vi.mocked(desktopOpenDialog).mockResolvedValue(null);

        const result = await selectNativeAudioExportDirectory();

        expect(result).toBeNull();
        expect(desktopOpenDialog).toHaveBeenCalledWith({
            directory: true,
            multiple: false,
            title: 'Select Output Folder for Slices (Stems)',
        });
    });
});
