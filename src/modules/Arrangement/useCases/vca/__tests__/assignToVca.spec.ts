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

    it('returns false and writes nothing when the target group does not exist', () => {
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        setTrackState({ tracks: [track], selectedTrackId: null });

        const result = assignToVca(track.id, 'no-such-group');

        expect(result).toBe(false);
        expect(getTrackById(track.id)?.vcaGroupId).toBeNull();
    });

    it('returns false when the track is already a member and already tagged', () => {
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        track.vcaGroupId = 'vca-1';
        setTrackState({ tracks: [track], selectedTrackId: null });
        setVcaGroupsState([{ id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [track.id] }]);

        const result = assignToVca(track.id, 'vca-1');

        expect(result).toBe(false);
    });

    it('adds the track id to the group without touching other groups', () => {
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        setTrackState({ tracks: [track], selectedTrackId: null });
        setVcaGroupsState([
            { id: 'vca-other', name: 'Other', gain: 1, muted: false, trackIds: ['someone-else'] },
            { id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [] },
        ]);

        assignToVca(track.id, 'vca-1');

        expect(getVcaGroupsState()).toEqual([
            { id: 'vca-other', name: 'Other', gain: 1, muted: false, trackIds: ['someone-else'] },
            { id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [track.id] },
        ]);
    });

    it('adds a member to the group while leaving the already-correct track tag alone', () => {
        // Track is tagged vca-1 but is absent from the group's member list:
        // the group must change (add the member) but vcaGroupId is already correct.
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        track.vcaGroupId = 'vca-1';
        setTrackState({ tracks: [track], selectedTrackId: null });
        setVcaGroupsState([{ id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [] }]);

        const result = assignToVca(track.id, 'vca-1');

        expect(result).toBe(true);
        expect(getVcaGroupsState()[0]?.trackIds).toEqual([track.id]);
        expect(getTrackById(track.id)?.vcaGroupId).toBe('vca-1');
    });

    it('re-tags a track whose vcaGroupId is stale while the group already lists it', () => {
        // Track is a member of vca-1 but its tag still points elsewhere:
        // the group is unchanged, but the tag must be updated.
        const track = createTrack({ id: 'track-1', name: 'Drums', kind: 'audio' });
        track.vcaGroupId = 'stale-group';
        setTrackState({ tracks: [track], selectedTrackId: null });
        setVcaGroupsState([{ id: 'vca-1', name: 'VCA', gain: 1, muted: false, trackIds: [track.id] }]);

        const result = assignToVca(track.id, 'vca-1');

        expect(result).toBe(true);
        expect(getVcaGroupsState()[0]?.trackIds).toEqual([track.id]);
        expect(getTrackById(track.id)?.vcaGroupId).toBe('vca-1');
    });
});
