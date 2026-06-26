import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = {
    setLevainParamWithAudio: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

import { setLevainParamWithAudio } from '../setLevainParamWithAudio';

describe('setLevainParamWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId, key, and value to the bridge', () => {
        setLevainParamWithAudio('dev-1', 'masterGain', 0.42);

        expect(bridge.setLevainParamWithAudio).toHaveBeenCalledTimes(1);
        expect(bridge.setLevainParamWithAudio).toHaveBeenCalledWith('dev-1', 'masterGain', 0.42);
    });
});
