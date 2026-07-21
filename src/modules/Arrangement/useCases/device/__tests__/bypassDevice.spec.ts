import { describe, it, expect, vi, beforeEach } from 'vitest';

import { bypassDevice } from '../bypassDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
    updateDeviceBypass: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

// Mock dynamic import
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceBypass: mocks.updateDeviceBypass,
}));

describe('bypassDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates bypass state in store and engine', async () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', devices: [{ id: 'd1' }] }],
        });

        const didWrite = bypassDevice('d1', true);

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const call = mocks.mapAllTracks.mock.calls[0];
        if (!call) {
            throw new Error('expected mapAllTracks to be called');
        }
        const updater = call[0];
        expect(updater({ devices: [{ id: 'd1', bypassed: false }] })).toEqual({
            devices: [{ id: 'd1', bypassed: true }],
        });

        // Note: The dynamic import might be tricky to test perfectly here,
        // but let's assume it calls updateDeviceBypass.
        await vi.waitFor(() => {
            expect(mocks.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        });
        expect(didWrite).toBe(true);
    });

    it('rejects dormant VCA bypass before project or engine mutation', async () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'vca-1', kind: 'vca', devices: [{ id: 'd1' }] }],
        });

        const didWrite = bypassDevice('d1', true);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(mocks.updateDeviceBypass).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });
});
