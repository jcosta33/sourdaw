import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBypassDevice } from '../handleBypassDevice';

const mocks = vi.hoisted(() => ({
    bypassDevice: vi.fn(),
}));

vi.mock('../../../useCases/device/bypassDevice', () => ({
    bypassDevice: mocks.bypassDevice,
}));

describe('handleBypassDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes bypassDevice with the provided payload', () => {
        mocks.bypassDevice.mockReturnValue(true);
        const result = handleBypassDevice.execute({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });

        expect(mocks.bypassDevice).toHaveBeenCalledWith('d1', true);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when bypassDevice rejects the device owner', () => {
        mocks.bypassDevice.mockReturnValue(false);
        const result = handleBypassDevice.execute({
            type: 'bypassDevice',
            payload: { deviceId: 'vca-device', bypassed: true },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting the bypassed state', () => {
        const desc1 = handleBypassDevice.describe({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });
        expect(desc1.label).toBe('Bypass device');

        const desc2 = handleBypassDevice.describe({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: false },
        });
        expect(desc2.label).toBe('Enable device');
    });

    it('is undoable', () => {
        expect(handleBypassDevice.undoable).toBe(true);
    });
});
