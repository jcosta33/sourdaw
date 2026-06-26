import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = {
    unregisterLevainDevice: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

import { unregisterLevainDevice } from '../unregisterLevainDevice';

describe('unregisterLevainDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the deviceId to the bridge', () => {
        unregisterLevainDevice('dev-1');

        expect(bridge.unregisterLevainDevice).toHaveBeenCalledTimes(1);
        expect(bridge.unregisterLevainDevice).toHaveBeenCalledWith('dev-1');
    });
});
