import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFileBytes } from '#/utils/desktopBridge';

import { writeNativeAudioMixdownFile } from '../writeNativeAudioMixdownFile';

vi.mock('#/utils/desktopBridge', () => ({
    writeFileBytes: vi.fn(),
}));

describe('writeNativeAudioMixdownFile', () => {
    beforeEach(() => {
        vi.mocked(writeFileBytes).mockReset();
    });

    it('should replace the selected file extension for each native mixdown format write', async () => {
        const wavBytes = new Uint8Array([1, 2, 3]);
        const mp3Bytes = new Uint8Array([4, 5, 6]);

        await writeNativeAudioMixdownFile({
            bytes: wavBytes,
            format: 'wav',
            selectedFilePath: '/exports/Sourdaw_Bake_1.wav',
        });
        await writeNativeAudioMixdownFile({
            bytes: mp3Bytes,
            format: 'mp3',
            selectedFilePath: '/exports/Sourdaw_Bake_1.wav',
        });

        expect(writeFileBytes).toHaveBeenNthCalledWith(1, {
            bytes: wavBytes,
            path: '/exports/Sourdaw_Bake_1.wav',
        });
        expect(writeFileBytes).toHaveBeenNthCalledWith(2, {
            bytes: mp3Bytes,
            path: '/exports/Sourdaw_Bake_1.mp3',
        });
    });
});
