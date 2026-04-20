import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { updateDeviceBypass } from '../updateDeviceBypass';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceBypass: vi.fn(),
    },
}));

describe('updateDeviceBypass', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDeviceBypass).mockClear();
    });

    it('should forward to the audio engine', () => {
        updateDeviceBypass('t1', 'd1', true);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
    });
});
