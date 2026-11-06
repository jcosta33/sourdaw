import { describe, expect, it, vi } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { setControlRoomMonitoring } from '../setControlRoomMonitoring';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { setControlRoomMonitoring: vi.fn() },
}));

describe('setControlRoomMonitoring', () => {
    it('hands the monitoring to the app engine’s listening path unchanged', () => {
        setControlRoomMonitoring({ monoActive: true, dimGain: 0.25 });

        expect(audioEngine.setControlRoomMonitoring).toHaveBeenCalledExactlyOnceWith({
            monoActive: true,
            dimGain: 0.25,
        });
    });
});
