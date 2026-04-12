import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { startSequencer, stopSequencer } from '../sequencerPlayback';
import { getAudioTime } from '#/modules/AudioEngine/useCases';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioTime: vi.fn(() => 0),
}));

describe('startSequencer', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(getAudioTime).mockClear();
    });

    it('reads the audio clock when starting', () => {
        startSequencer(120, 4);
        stopSequencer();

        expect(getAudioTime).toHaveBeenCalled();
    });
});
