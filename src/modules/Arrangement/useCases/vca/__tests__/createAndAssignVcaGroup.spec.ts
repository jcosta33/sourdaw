import { describe, it, expect, beforeEach } from 'vitest';

import { setTrackState } from '../../../repositories/track/setTrackState';
import { trackStore } from '../../../stores/trackStore';
import { getVcaGroupsState, setVcaGroupsState } from '../../../stores/vcaGroupStore';
import { createAndAssignVcaGroup } from '../createAndAssignVcaGroup';

describe('createAndAssignVcaGroup', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        setTrackState({ tracks: [{ id: 't1', vcaGroupId: null } as never], selectedTrackId: null });
    });

    it('persists the new group in the VCA store and assigns the track', () => {
        createAndAssignVcaGroup('t1');

        const groups = getVcaGroupsState();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.name).toBe('VCA 1');
        expect(groups[0]?.trackIds).toEqual(['t1']);

        const track = trackStore.value?.tracks.find((t) => t.id === 't1');
        expect(track?.vcaGroupId).toBe(groups[0]?.id);
    });

    it('names sequentially from the persisted store, not a volatile counter', () => {
        setVcaGroupsState([{ id: 'vca-existing', name: 'VCA 1', gain: 1, muted: false, trackIds: [] }]);

        createAndAssignVcaGroup('t1');

        const groups = getVcaGroupsState();
        expect(groups).toHaveLength(2);
        expect(groups[1]?.name).toBe('VCA 2');
        expect(groups[1]?.trackIds).toEqual(['t1']);
    });
});
