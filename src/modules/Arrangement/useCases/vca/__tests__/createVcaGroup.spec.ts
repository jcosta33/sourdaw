import { beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import { getTrackById } from '../../../repositories/track/getTrackById';
import { setTrackState } from '../../../repositories/track/setTrackState';
import { getVcaGroupsState, setVcaGroupsState } from '../../../stores/vcaGroupStore';
import { createVcaGroup } from '../createVcaGroup';

describe('createVcaGroup', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        setTrackState({ tracks: [], selectedTrackId: null });
    });

    it('creates one legacy owner for each valid unique member', () => {
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        track.vcaGroupId = 'vca-old';
        setTrackState({ tracks: [track], selectedTrackId: track.id });
        setVcaGroupsState([{ id: 'vca-old', name: 'Old', gain: 1, muted: false, trackIds: [track.id] }]);

        const created = createVcaGroup('New', [track.id, track.id, 'missing-track']);

        expect(getVcaGroupsState()).toEqual([
            { id: 'vca-old', name: 'Old', gain: 1, muted: false, trackIds: [] },
            created,
        ]);
        expect(created.trackIds).toEqual([track.id]);
        expect(getTrackById(track.id)?.vcaGroupId).toBe(created.id);
    });

    it('throws when the requested vca group id already exists', () => {
        setVcaGroupsState([{ id: 'vca-dup', name: 'Existing', gain: 1, muted: false, trackIds: [] }]);

        expect(() => createVcaGroup('Dup', [], 'vca-dup')).toThrowError(/already exists/);
    });
});
