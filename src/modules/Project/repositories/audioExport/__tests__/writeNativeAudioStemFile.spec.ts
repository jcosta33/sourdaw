import { beforeEach, describe, expect, it, vi } from 'vitest';

import { join } from '@tauri-apps/api/path';
import { writeFile } from '@tauri-apps/plugin-fs';

import { writeNativeAudioStemFile } from '../writeNativeAudioStemFile';

vi.mock('@tauri-apps/api/path', () => ({
    join: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
}));

describe('writeNativeAudioStemFile', () => {
    beforeEach(() => {
        vi.mocked(join).mockReset();
        vi.mocked(writeFile).mockReset();
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
        expect(writeFile).toHaveBeenCalledWith('/exports/Kick.wav', bytes);
    });
});
