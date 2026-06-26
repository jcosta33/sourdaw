import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { assignToVca } from '../assignToVca';
import { removeFromVca } from '../removeFromVca';
import { toggleVcaMembership } from '../toggleVcaMembership';

vi.mock('../removeFromVca', () => ({
    removeFromVca: vi.fn(),
}));

vi.mock('../assignToVca', () => ({
    assignToVca: vi.fn(),
}));

const mockGetTrackById = vi.fn();
vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: (...args: any[]) => mockGetTrackById(...args),
}));

describe('toggleVcaMembership', () => {
    beforeEach(() => {
        vi.mocked(assignToVca).mockClear();
        vi.mocked(removeFromVca).mockClear();
        mockGetTrackById.mockReset();
    });

    it('should do nothing when track is missing', () => {
        mockGetTrackById.mockReturnValue(undefined);

        toggleVcaMembership('t1', 'g1');

        expect(assignToVca).not.toHaveBeenCalled();
        expect(removeFromVca).not.toHaveBeenCalled();
    });

    it('should remove when track is already in the group', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        toggleVcaMembership('t1', 'g1');

        expect(removeFromVca).toHaveBeenCalledWith('t1');
        expect(assignToVca).not.toHaveBeenCalled();
    });

    it('should assign when track is in another or no group', () => {
        const track = { vcaGroupId: null } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        toggleVcaMembership('t1', 'g2');

        expect(assignToVca).toHaveBeenCalledWith('t1', 'g2');
        expect(removeFromVca).not.toHaveBeenCalled();
    });
});
