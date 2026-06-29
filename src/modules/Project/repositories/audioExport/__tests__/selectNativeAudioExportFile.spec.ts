import { beforeEach, describe, expect, it, vi } from 'vitest';

import { save } from '@tauri-apps/plugin-dialog';

import { selectNativeAudioExportFile } from '../selectNativeAudioExportFile';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
}));

describe('selectNativeAudioExportFile', () => {
    beforeEach(() => {
        vi.mocked(save).mockReset();
    });

    it('should request a native audio save path with the suggested name and format filters', async () => {
        vi.mocked(save).mockResolvedValue('/exports/Sourdaw_Bake_1.wav');

        const result = await selectNativeAudioExportFile({
            formats: ['wav', 'mp3'],
            suggestedName: 'Sourdaw_Bake_1.wav',
        });

        expect(result).toBe('/exports/Sourdaw_Bake_1.wav');
        expect(save).toHaveBeenCalledWith({
            defaultPath: 'Sourdaw_Bake_1.wav',
            filters: [{ name: 'Audio File', extensions: ['wav', 'mp3'] }],
        });
    });
});
