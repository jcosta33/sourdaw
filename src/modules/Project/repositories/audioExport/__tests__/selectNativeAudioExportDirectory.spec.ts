import { beforeEach, describe, expect, it, vi } from 'vitest';

import { open } from '@tauri-apps/plugin-dialog';

import { selectNativeAudioExportDirectory } from '../selectNativeAudioExportDirectory';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

describe('selectNativeAudioExportDirectory', () => {
    beforeEach(() => {
        vi.mocked(open).mockReset();
    });

    it('should return null when native directory selection is cancelled', async () => {
        vi.mocked(open).mockResolvedValue(null);

        const result = await selectNativeAudioExportDirectory();

        expect(result).toBeNull();
        expect(open).toHaveBeenCalledWith({
            directory: true,
            multiple: false,
            title: 'Select Output Folder for Slices (Stems)',
        });
    });
});
