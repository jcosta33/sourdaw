import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = {
    setMacroWithAudio: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

import { setMacroWithAudio } from '../setMacroWithAudio';

describe('setMacroWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId, macro index, and value to the bridge', () => {
        setMacroWithAudio('dev-1', 4, 0.7);

        expect(bridge.setMacroWithAudio).toHaveBeenCalledTimes(1);
        expect(bridge.setMacroWithAudio).toHaveBeenCalledWith('dev-1', 4, 0.7);
    });
});
