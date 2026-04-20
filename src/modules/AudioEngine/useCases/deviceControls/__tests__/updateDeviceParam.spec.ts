import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { updateDeviceParam } from '../updateDeviceParam';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceParam: vi.fn(),
    },
}));

describe('updateDeviceParam', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDeviceParam).mockClear();
    });

    it('should forward to the audio engine', () => {
        updateDeviceParam('t1', 'd1', 'gain', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.75);
    });
});
