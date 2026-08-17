import { describe, expect, it, vi, beforeEach } from 'vitest';

import { compileAddDeviceAction } from '../compileAddDeviceAction';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('compileAddDeviceAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'track-1', kind: 'audio', frozen: false, devices: [{ id: 'device-1' }, { id: 'device-2' }] },
            ],
        });
    });

    it('binds a UI add request to the current ordered chain and application-owned identity', () => {
        const action = compileAddDeviceAction('track-1', 'builtin-compressor');

        expect(action).toEqual({
            type: 'addDevice',
            payload: {
                trackId: 'track-1',
                deviceType: 'builtin-compressor',
                deviceId: expect.stringMatching(/^device-/),
                expectedDeviceIds: ['device-1', 'device-2'],
                expectedFrozen: false,
            },
        });
    });

    it('refuses an ambiguous or duplicate chain before dispatch', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'track-1', kind: 'audio', frozen: false, devices: [{ id: 'duplicate' }, { id: 'duplicate' }] },
                { id: 'track-1', kind: 'audio', frozen: false, devices: [] },
            ],
        });

        expect(compileAddDeviceAction('track-1', 'builtin-compressor')).toBeNull();
    });
});
