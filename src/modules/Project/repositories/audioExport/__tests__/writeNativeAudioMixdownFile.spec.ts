import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFile } from '@tauri-apps/plugin-fs';

import { writeNativeAudioMixdownFile } from '../writeNativeAudioMixdownFile';

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
}));

describe('writeNativeAudioMixdownFile', () => {
    beforeEach(() => {
        vi.mocked(writeFile).mockReset();
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

        expect(writeFile).toHaveBeenNthCalledWith(1, '/exports/Sourdaw_Bake_1.wav', wavBytes);
        expect(writeFile).toHaveBeenNthCalledWith(2, '/exports/Sourdaw_Bake_1.mp3', mp3Bytes);
    });
});
