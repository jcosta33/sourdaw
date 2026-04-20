import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases/engineAccess/getAudioTime';

import { startSequencer, stopSequencer } from '../sequencerPlayback';

vi.mock('#/modules/AudioEngine/useCases/engineAccess/getAudioTime', () => ({
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
