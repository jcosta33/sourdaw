import { beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import { getTrackById } from '../../../repositories/track/getTrackById';
import { setTrackState } from '../../../repositories/track/setTrackState';
import { getVcaGroupsState, setVcaGroupsState } from '../../../stores/vcaGroupStore';
import { assignToVca } from '../assignToVca';

describe('assignToVca', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        setTrackState({ tracks: [], selectedTrackId: null });
    });

    it('moves an existing track to exactly one legacy VCA group', () => {
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        track.vcaGroupId = 'vca-old';
        setTrackState({ tracks: [track], selectedTrackId: track.id });
        setVcaGroupsState([
            { id: 'vca-old', name: 'Old', gain: 1, muted: false, trackIds: [track.id] },
            { id: 'vca-new', name: 'New', gain: 1, muted: false, trackIds: [] },
        ]);

        assignToVca(track.id, 'vca-new');

        expect(getVcaGroupsState()).toEqual([
            { id: 'vca-old', name: 'Old', gain: 1, muted: false, trackIds: [] },
            { id: 'vca-new', name: 'New', gain: 1, muted: false, trackIds: [track.id] },
        ]);
        expect(getTrackById(track.id)?.vcaGroupId).toBe('vca-new');
    });

    it('does not create a dangling group member when the track identity is missing', () => {
        setVcaGroupsState([{ id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [] }]);

        assignToVca('missing-track', 'vca-1');

        expect(getVcaGroupsState()[0]?.trackIds).toEqual([]);
    });
});
