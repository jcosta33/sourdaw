import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = {
    sendMicParamToEngine: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

import { sendMicParamToEngine } from '../sendMicParamToEngine';

describe('sendMicParamToEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId, mic index, param, and value to the bridge', () => {
        sendMicParamToEngine('dev-1', 2, 'volume', 0.5);

        expect(bridge.sendMicParamToEngine).toHaveBeenCalledTimes(1);
        expect(bridge.sendMicParamToEngine).toHaveBeenCalledWith('dev-1', 2, 'volume', 0.5);
    });
});
