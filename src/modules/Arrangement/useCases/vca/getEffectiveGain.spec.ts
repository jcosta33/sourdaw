import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { getVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';
import { getEffectiveGain } from './getEffectiveGain';

vi.mock('#/modules/Arrangement/stores/vcaGroupStore', () => ({
    getVcaGroupsState: vi.fn(() => []),
}));

describe('getEffectiveGain', () => {
    beforeEach(() => {
        vi.mocked(getVcaGroupsState).mockReset();
        vi.mocked(getVcaGroupsState).mockReturnValue([]);
    });

    it('should return raw gain when track has no VCA group', () => {
        const track = { vcaGroupId: null } as unknown as Track;
        const getTrackById = vi.fn(() => track);
        injectDependencies(getEffectiveGain, { getTrackById });

        expect(getEffectiveGain('t1', 0.75)).toBe(0.75);
    });

    it('should return raw gain when track is missing', () => {
        const getTrackById = vi.fn(() => undefined);
        injectDependencies(getEffectiveGain, { getTrackById });

        expect(getEffectiveGain('t1', 0.75)).toBe(0.75);
    });

    it('should multiply by VCA group gain when group exists', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        const getTrackById = vi.fn(() => track);
        injectDependencies(getEffectiveGain, { getTrackById });

        vi.mocked(getVcaGroupsState).mockReturnValue([
            { id: 'g1', name: 'VCA', gain: 0.5, muted: false, trackIds: [] },
        ]);

        expect(getEffectiveGain('t1', 2)).toBe(1);
    });

    it('should return raw gain when VCA group id is missing from store', () => {
        const track = { vcaGroupId: 'g1' } as unknown as Track;
        const getTrackById = vi.fn(() => track);
        injectDependencies(getEffectiveGain, { getTrackById });

        vi.mocked(getVcaGroupsState).mockReturnValue([
            { id: 'other', name: 'VCA', gain: 0.25, muted: false, trackIds: [] },
        ]);

        expect(getEffectiveGain('t1', 2)).toBe(2);
    });
});
