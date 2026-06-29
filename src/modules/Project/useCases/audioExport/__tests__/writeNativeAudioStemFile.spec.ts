import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeNativeAudioStemFile } from '../writeNativeAudioStemFile';

const mocks = vi.hoisted(() => ({
    writeNativeAudioStemFile: vi.fn(),
}));

vi.mock('../../../repositories/audioExport/writeNativeAudioStemFile', () => ({
    writeNativeAudioStemFile: mocks.writeNativeAudioStemFile,
}));

describe('writeNativeAudioStemFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward the directory path, file name, and bytes to the native stem repository', async () => {
        const bytes = new Uint8Array([7, 8, 9]);

        await writeNativeAudioStemFile({
            bytes,
            directoryPath: '/exports',
            fileName: 'Kick.wav',
        });

        expect(mocks.writeNativeAudioStemFile).toHaveBeenCalledWith({
            bytes,
            directoryPath: '/exports',
            fileName: 'Kick.wav',
        });
    });
});
