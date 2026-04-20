import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getFirstToasterDeviceId } from '../getFirstToasterDeviceId';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

describe('getFirstToasterDeviceId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null when no track has a toaster device', () => {
        mocks.getAllTracks.mockReturnValue([{ devices: [] }]);

        expect(getFirstToasterDeviceId()).toBeNull();
    });

    it('should return the id of the first toaster device across tracks', () => {
        mocks.getAllTracks.mockReturnValue([
            { devices: [{ type: 'gain', id: 'x' }] },
            { devices: [{ type: 'toaster', id: 'toast-1' }] },
        ]);

        expect(getFirstToasterDeviceId()).toBe('toast-1');
    });
});
