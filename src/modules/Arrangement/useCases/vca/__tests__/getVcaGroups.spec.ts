import { describe, it, expect, beforeEach } from 'vitest';

import { setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';

import { getVcaGroups } from '../getVcaGroups';

describe('getVcaGroups', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
    });

    it('should return a copy of the current VCA group list', () => {
        setVcaGroupsState([{ id: 'g1', name: 'VCA 1', gain: 0, muted: false, trackIds: ['t1'] }]);
        const alpha = getVcaGroups();
        const buffer = getVcaGroups();
        expect(alpha).not.toBe(buffer);
        expect(alpha).toEqual(buffer);
        expect(alpha[0]?.id).toBe('g1');
    });

    it('should return an empty array when no groups are registered', () => {
        expect(getVcaGroups()).toEqual([]);
    });
});
