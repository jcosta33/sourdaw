import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleBypassDevice } from '../handleBypassDevice';

const mocks = vi.hoisted(() => ({
    bypassDevice: vi.fn(),
    getTrackStoreState:
        vi.fn<() => { tracks: { id: string; devices: { id: string; bypassed: boolean }[] }[] } | null>(),
}));

vi.mock('../../../useCases/device/bypassDevice', () => ({
    bypassDevice: mocks.bypassDevice,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleBypassDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
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

    it('describes an inverse restoring the previous bypassed state', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', bypassed: false }] }],
        });

        const desc = handleBypassDevice.describe({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: false },
        });
    });

    it('does not negate the payload when the forward bypass is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', bypassed: true }] }],
        });

        const desc = handleBypassDevice.describe({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });

        // Bypassing an already-bypassed device changes nothing; a negating
        // inverse would wrongly enable it. The inverse restores the pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });
    });

    it('describes a null inverse when the device is not found', () => {
        const desc = handleBypassDevice.describe({
            type: 'bypassDevice',
            payload: { deviceId: 'missing', bypassed: true },
        });

        expect(desc.inverseAction).toBeNull();
    });

    it('detects an unchanged bypass state as a semantic no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', bypassed: true }] }],
        });

        const isNoop = handleBypassDevice.isNoop?.({
            type: 'bypassDevice',
            payload: { deviceId: 'd1', bypassed: true },
        });

        expect(isNoop).toBe(true);
    });

    it('is undoable', () => {
        expect(handleBypassDevice.undoable).toBe(true);
    });
});
