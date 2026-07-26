import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { getVcaGroupsState } from '../../../stores/vcaGroupStore';
import { getEffectiveGain } from '../getEffectiveGain';

// Only the store read is faked. `deriveVcaMultiplier` stays real: it is the
// shared derivation the offline render also evaluates, so stubbing it here
// would stop these cases proving anything about the multiplier itself.
vi.mock('../../../stores/vcaGroupStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/vcaGroupStore')>()),
    getVcaGroupsState: vi.fn(() => []),
}));

const mockGetTrackById = vi.fn();
vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: (...args: any[]) => mockGetTrackById(...args),
}));

describe('getEffectiveGain', () => {
    beforeEach(() => {
        vi.mocked(getVcaGroupsState).mockReset();
        vi.mocked(getVcaGroupsState).mockReturnValue([]);
        mockGetTrackById.mockReset();
    });

    it('should return raw gain when track has no VCA group', () => {
        const track = { vcaGroupId: null } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        expect(getEffectiveGain('t1', 0.75)).toBe(0.75);
    });

    it('should return raw gain when track is missing', () => {
        mockGetTrackById.mockReturnValue(undefined);

        expect(getEffectiveGain('t1', 0.75)).toBe(0.75);
    });

    it('should multiply by VCA group gain when group exists', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        vi.mocked(getVcaGroupsState).mockReturnValue([
            { id: 'g1', name: 'VCA', gain: 0.5, muted: false, trackIds: [] },
        ]);

        expect(getEffectiveGain('t1', 2)).toBe(1);
    });

    it('should return raw gain when VCA group id is missing from store', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        mockGetTrackById.mockReturnValue(track);

        vi.mocked(getVcaGroupsState).mockReturnValue([
            { id: 'other', name: 'VCA', gain: 0.25, muted: false, trackIds: [] },
        ]);

        expect(getEffectiveGain('t1', 2)).toBe(2);
    });
});
