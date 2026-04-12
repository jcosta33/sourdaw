import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reorderDevices } from '../reorderDevices';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('reorderDevices', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reorders devices within a track', () => {
        reorderDevices('t1', 0, 1);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];

        const mockTrack = {
            devices: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]
        };

        const result = updater(mockTrack);
        expect(result.devices[0].id).toBe('d2');
        expect(result.devices[1].id).toBe('d1');
        expect(result.devices[2].id).toBe('d3');
    });
});
