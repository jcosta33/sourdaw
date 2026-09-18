import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSaveDialog } from '#/utils/desktopBridge';

import { selectNativeAudioExportFile } from '../selectNativeAudioExportFile';

vi.mock('#/utils/desktopBridge', () => ({
    desktopSaveDialog: vi.fn(),
}));

describe('selectNativeAudioExportFile', () => {
    beforeEach(() => {
        vi.mocked(desktopSaveDialog).mockReset();
    });

    it('should request a native audio save path with the suggested name and format filters', async () => {
        vi.mocked(desktopSaveDialog).mockResolvedValue('/exports/Sourdaw_Bake_1.wav');

        const result = await selectNativeAudioExportFile({
            formats: ['wav', 'mp3'],
            suggestedName: 'Sourdaw_Bake_1.wav',
        });

        expect(result).toBe('/exports/Sourdaw_Bake_1.wav');
        expect(desktopSaveDialog).toHaveBeenCalledWith({
            defaultPath: 'Sourdaw_Bake_1.wav',
            filters: [{ name: 'Audio File', extensions: ['wav', 'mp3'] }],
        });
    });
});
