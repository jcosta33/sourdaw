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
        handleBypassDevice.execute({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });

        expect(mocks.bypassDevice).toHaveBeenCalledWith('d1', true);
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
