import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerLevainDevice } from '../registerLevainDevice';

import type { LevainDevice } from '../helpers';

const bridge = {
    registerLevainDevice: vi.fn(() => Promise.resolve('ready' as const)),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

describe('registerLevainDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId, device, and port to the bridge', async () => {
        const device: LevainDevice = { setParam: vi.fn(), handleCc: vi.fn() };
        const port = {} as MessagePort;

        const outcome = await registerLevainDevice('dev-1', device, port);

        expect(outcome).toBe('ready');
        expect(bridge.registerLevainDevice).toHaveBeenCalledTimes(1);
        expect(bridge.registerLevainDevice).toHaveBeenCalledWith('dev-1', device, port);
    });
});
