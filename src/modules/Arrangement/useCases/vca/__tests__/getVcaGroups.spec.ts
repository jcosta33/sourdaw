import { describe, it, expect, beforeEach } from 'vitest';

<<<<<<< HEAD
import { setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';

import { getVcaGroups } from '../getVcaGroups';
=======
const mockGetVcaGroupsState = vi.fn();
vi.mock('../../../stores/vcaGroupStore', () => ({
    getVcaGroupsState: () => mockGetVcaGroupsState()
}));
>>>>>>> agent/refactor-code-quality

describe('getVcaGroups', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
    });

    it('should return a copy of the current VCA group list', () => {
        setVcaGroupsState([{ id: 'g1', name: 'VCA 1', gain: 0, muted: false, trackIds: ['t1'] }]);
        const a = getVcaGroups();
        const b = getVcaGroups();
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
        expect(a[0]?.id).toBe('g1');
    });

    it('should return an empty array when no groups are registered', () => {
        expect(getVcaGroups()).toEqual([]);
    });
});
