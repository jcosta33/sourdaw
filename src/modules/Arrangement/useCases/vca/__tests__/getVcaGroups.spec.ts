import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getVcaGroups } from '../getVcaGroups';

const mockGetVcaGroupsState = vi.fn();
vi.mock('../../../stores/vcaGroupStore', () => ({
    getVcaGroupsState: () => mockGetVcaGroupsState()
}));

describe('getVcaGroups', () => {
    beforeEach(() => {
        mockGetVcaGroupsState.mockReset();
    });

    it('returns a copy of the groups from the injected getter', () => {
        const g1 = { id: 'v1', name: 'A', gain: 1, muted: false, trackIds: [] };
        mockGetVcaGroupsState.mockReturnValue([g1]);

        const out = getVcaGroups();
        expect(out).toEqual([g1]);
        out.pop();
        expect(getVcaGroups()).toHaveLength(1);
    });
});
