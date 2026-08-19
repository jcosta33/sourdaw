import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileBytes } from '#/utils/desktopBridge';

import { readNativeAudioFileBytes } from '../readNativeAudioFileBytes';

vi.mock('#/utils/desktopBridge', () => ({
    readFileBytes: vi.fn(),
}));

describe('readNativeAudioFileBytes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should read the absolute path over the binary IPC path and return the raw bytes', async () => {
        vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array([0, 128, 255]));

        const bytes = await readNativeAudioFileBytes({ path: '/Users/jose/Samples/kick.wav' });

        expect(readFileBytes).toHaveBeenCalledWith({ path: '/Users/jose/Samples/kick.wav' });
        expect([...bytes]).toEqual([0, 128, 255]);
    });
});
