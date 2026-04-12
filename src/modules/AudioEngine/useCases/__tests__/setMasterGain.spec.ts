import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioEngine } from '../../repositories/createWebAudioEngine';
import { setMasterGain } from '../setMasterGain';

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        setMasterGain: vi.fn(),
    },
}));

describe('setMasterGain', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.setMasterGain).mockClear();
    });

    it('should forward the gain value to the audio engine', () => {
        setMasterGain(0.75);

        expect(audioEngine.setMasterGain).toHaveBeenCalledTimes(1);
        expect(audioEngine.setMasterGain).toHaveBeenCalledWith(0.75);
    });
});
