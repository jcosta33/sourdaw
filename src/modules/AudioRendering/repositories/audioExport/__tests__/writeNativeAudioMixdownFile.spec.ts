import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { writeNativeAudioMixdownFile } from '../writeNativeAudioMixdownFile';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('writeNativeAudioMixdownFile', () => {
    beforeEach(() => {
        vi.mocked(invoke).mockReset();
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

        expect(invoke).toHaveBeenNthCalledWith(1, 'write_audio_file', {
            path: '/exports/Sourdaw_Bake_1.wav',
            data: [1, 2, 3],
        });
        expect(invoke).toHaveBeenNthCalledWith(2, 'write_audio_file', {
            path: '/exports/Sourdaw_Bake_1.mp3',
            data: [4, 5, 6],
        });
    });
});
