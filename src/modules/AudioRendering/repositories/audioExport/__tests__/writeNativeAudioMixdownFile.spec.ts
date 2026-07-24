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

        expect(invoke).toHaveBeenNthCalledWith(1, 'write_file_bytes', expect.any(ArrayBuffer), {
            headers: { 'x-sourdaw-path': encodeURIComponent('/exports/Sourdaw_Bake_1.wav') },
        });
        expect(invoke).toHaveBeenNthCalledWith(2, 'write_file_bytes', expect.any(ArrayBuffer), {
            headers: { 'x-sourdaw-path': encodeURIComponent('/exports/Sourdaw_Bake_1.mp3') },
        });

        const [firstCall, secondCall] = vi.mocked(invoke).mock.calls as unknown as [string, ArrayBuffer][];
        if (!firstCall || !secondCall) {
            throw new Error('Expected two native mixdown writes');
        }
        expect(new Uint8Array(firstCall[1])).toEqual(wavBytes);
        expect(new Uint8Array(secondCall[1])).toEqual(mp3Bytes);
    });
});
