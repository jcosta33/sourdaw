import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { setTrackPan } from '../setTrackPan';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        setTrackPan: vi.fn(),
    },
}));

describe('setTrackPan', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.setTrackPan).mockClear();
    });

    it('should forward pan to the audio engine', () => {
        setTrackPan('t1', -0.5);

        expect(audioEngine.setTrackPan).toHaveBeenCalledWith('t1', -0.5);
    });
});
