import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderDevices } from '../reorderDevices';

const mocks = vi.hoisted(() => {
    type Track = { devices: { id: string }[] };
    return {
        getTrackById: vi.fn(),
        updateTrack: vi.fn<(trackId: string, updater: (track: Track) => Track) => void>(),
        applyDeviceChainRuntimeDelta: vi.fn(),
    };
});

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

describe('reorderDevices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            kind: 'audio',
            devices: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
        });
    });

    it('reorders devices within a track', () => {
        reorderDevices('t1', 0, 1);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'reorder-device' })
        );
        const updaterCall = mocks.updateTrack.mock.calls[0];
        if (!updaterCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const updater = updaterCall[1];

        const mockTrack = { devices: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] };

        const result = updater(mockTrack);
        expect(result.devices[0]?.id).toBe('d2');
        expect(result.devices[1]?.id).toBe('d1');
        expect(result.devices[2]?.id).toBe('d3');
    });

    it('rejects dormant VCA reorder before a project write', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', devices: [] });

        reorderDevices('vca-1', 0, 1);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('leaves devices unchanged when the source index is out of range', () => {
        // No VCA mock carried over: an audio track is device-update eligible.
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', devices: [] });

        reorderDevices('t1', 5, 0);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
    });
});
