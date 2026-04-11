import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { decodeAudioFile } from './trackViewActions/decodeAudioFile';

describe('trackViewActions injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('decodeAudioFile forwards to decodeAudioFileImpl', async () => {
        const decodeAudioFileImpl = vi.fn().mockResolvedValue({
            id: 'b1',
            buffer: {} as AudioBuffer,
        });
        injectDependencies(decodeAudioFile, { decodeAudioFileImpl });

        const file = new File([], 'x.wav');
        await decodeAudioFile(file);

        expect(decodeAudioFileImpl).toHaveBeenCalledWith(file);
    });
});
