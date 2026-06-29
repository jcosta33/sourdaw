import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';

import { writeNativeAudioStemFile } from '../writeNativeAudioStemFile';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    join: vi.fn(),
}));

describe('writeNativeAudioStemFile', () => {
    beforeEach(() => {
        vi.mocked(invoke).mockReset();
        vi.mocked(join).mockReset();
    });

    it('should join the native stems directory with the encoded file name before writing bytes', async () => {
        const bytes = new Uint8Array([7, 8, 9]);
        vi.mocked(join).mockResolvedValue('/exports/Kick.wav');

        await writeNativeAudioStemFile({
            bytes,
            directoryPath: '/exports',
            fileName: 'Kick.wav',
        });

        expect(join).toHaveBeenCalledWith('/exports', 'Kick.wav');
        expect(invoke).toHaveBeenCalledWith('write_audio_file', {
            path: '/exports/Kick.wav',
            data: bytes,
        });
    });
});
