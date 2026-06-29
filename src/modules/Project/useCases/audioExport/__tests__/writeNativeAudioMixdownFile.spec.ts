import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeNativeAudioMixdownFile } from '../writeNativeAudioMixdownFile';

const mocks = vi.hoisted(() => ({
    writeNativeAudioMixdownFile: vi.fn(),
}));

vi.mock('../../../repositories/audioExport/writeNativeAudioMixdownFile', () => ({
    writeNativeAudioMixdownFile: mocks.writeNativeAudioMixdownFile,
}));

describe('writeNativeAudioMixdownFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward the selected file path, format, and bytes to the native mixdown repository', async () => {
        const bytes = new Uint8Array([1, 2, 3]);

        await writeNativeAudioMixdownFile({
            bytes,
            format: 'wav',
            selectedFilePath: '/exports/Sourdaw_Bake_1.wav',
        });

        expect(mocks.writeNativeAudioMixdownFile).toHaveBeenCalledWith({
            bytes,
            format: 'wav',
            selectedFilePath: '/exports/Sourdaw_Bake_1.wav',
        });
    });
});
