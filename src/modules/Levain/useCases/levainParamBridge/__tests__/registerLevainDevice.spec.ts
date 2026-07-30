import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerLevainDevice } from '../registerLevainDevice';

import type { LevainDevice } from '../helpers';

const bridge = {
    registerLevainDevice: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

describe('registerLevainDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId, device, and port to the bridge', () => {
        const device: LevainDevice = { setParam: vi.fn(), handleCc: vi.fn() };
        const port = {} as MessagePort;

        registerLevainDevice('dev-1', device, port);

        expect(bridge.registerLevainDevice).toHaveBeenCalledTimes(1);
        expect(bridge.registerLevainDevice).toHaveBeenCalledWith('dev-1', device, port);
    });

    it('forwards the initial content readiness callback when provided', () => {
        const device: LevainDevice = { setParam: vi.fn(), handleCc: vi.fn() };
        const port = {} as MessagePort;
        const onContentLoadSettled = vi.fn();

        registerLevainDevice('dev-1', device, port, onContentLoadSettled);

        expect(bridge.registerLevainDevice).toHaveBeenCalledWith('dev-1', device, port, onContentLoadSettled);
    });
});
