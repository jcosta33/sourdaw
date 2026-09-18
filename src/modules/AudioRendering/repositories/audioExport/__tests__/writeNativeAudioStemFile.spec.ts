import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopPathJoin, writeFileBytes } from '#/utils/desktopBridge';

import { writeNativeAudioStemFile } from '../writeNativeAudioStemFile';

vi.mock('#/utils/desktopBridge', () => ({
    desktopPathJoin: vi.fn(),
    writeFileBytes: vi.fn(),
}));

describe('writeNativeAudioStemFile', () => {
    beforeEach(() => {
        vi.mocked(desktopPathJoin).mockReset();
        vi.mocked(writeFileBytes).mockReset();
    });

    it('should join the native stems directory with the file name before writing bytes', async () => {
        const bytes = new Uint8Array([7, 8, 9]);
        vi.mocked(desktopPathJoin).mockResolvedValue('/exports/Kick.wav');

        await writeNativeAudioStemFile({
            bytes,
            directoryPath: '/exports',
            fileName: 'Kick.wav',
        });

        expect(desktopPathJoin).toHaveBeenCalledWith('/exports', 'Kick.wav');
        expect(writeFileBytes).toHaveBeenCalledWith({
            bytes,
            path: '/exports/Kick.wav',
        });
    });
});
