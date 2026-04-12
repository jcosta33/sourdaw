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
            tracks: [{ id: 't1', devices: [{ id: 'd1' }] }]
        });

        bypassDevice('d1', true);

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const updater = mocks.mapAllTracks.mock.calls[0][0];
        expect(updater({ devices: [{ id: 'd1', bypassed: false }] })).toEqual({ devices: [{ id: 'd1', bypassed: true }] });

        // Note: The dynamic import might be tricky to test perfectly here, 
        // but let's assume it calls updateDeviceBypass.
        await vi.waitFor(() => {
            expect(mocks.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        });
    });
});
