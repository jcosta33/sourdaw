import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectNativeAudioExportFile } from '../selectNativeAudioExportFile';

const mocks = vi.hoisted(() => ({
    selectNativeAudioExportFile: vi.fn(),
}));

vi.mock('../../../repositories/audioExport/selectNativeAudioExportFile', () => ({
    selectNativeAudioExportFile: mocks.selectNativeAudioExportFile,
}));

describe('selectNativeAudioExportFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward the suggested name and selected formats to the native file repository', async () => {
        mocks.selectNativeAudioExportFile.mockResolvedValue('/exports/Sourdaw_Bake_1.wav');

        await expect(
            selectNativeAudioExportFile({
                formats: ['wav', 'mp3'],
                suggestedName: 'Sourdaw_Bake_1.wav',
            })
        ).resolves.toBe('/exports/Sourdaw_Bake_1.wav');

        expect(mocks.selectNativeAudioExportFile).toHaveBeenCalledWith({
            formats: ['wav', 'mp3'],
            suggestedName: 'Sourdaw_Bake_1.wav',
        });
    });
});
