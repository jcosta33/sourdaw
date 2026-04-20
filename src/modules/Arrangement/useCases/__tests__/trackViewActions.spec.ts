import { describe, it, expect, vi } from 'vitest';

import { decodeAudioFile as decodeAudioFileImpl } from '#/modules/AudioEngine/useCases';

import { decodeAudioFile } from '../trackViewActions/decodeAudioFile';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: vi.fn(),
}));

describe('trackViewActions injectables', () => {
    it('decodeAudioFile forwards to decodeAudioFileImpl', async () => {
        const file = new File([], 'x.wav');
        vi.mocked(decodeAudioFileImpl).mockResolvedValue({
            id: 'b1',
            buffer: {} as AudioBuffer,
        });

        await decodeAudioFile(file);

        expect(decodeAudioFileImpl).toHaveBeenCalledWith(file);
    });
});
