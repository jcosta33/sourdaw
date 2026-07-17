import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderDevices } from '../reorderDevices';

const mocks = vi.hoisted(() => {
    type Track = { devices: { id: string }[] };
    return {
        updateTrack: vi.fn<(trackId: string, updater: (track: Track) => Track) => void>(),
    };
});

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('reorderDevices', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reorders devices within a track', () => {
        reorderDevices('t1', 0, 1);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updaterCall = mocks.updateTrack.mock.calls[0];
        if (!updaterCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const updater = updaterCall[1];

        const mockTrack = {
            devices: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
        };

        const result = updater(mockTrack);
        expect(result.devices[0]?.id).toBe('d2');
        expect(result.devices[1]?.id).toBe('d1');
        expect(result.devices[2]?.id).toBe('d3');
    });
});
