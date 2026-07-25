import { beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import { getTrackById } from '../../../repositories/track/getTrackById';
import { setTrackState } from '../../../repositories/track/setTrackState';
import { getVcaGroupsState, setVcaGroupsState } from '../../../stores/vcaGroupStore';
import { commitLegacyVcaTemplateState } from '../commitLegacyVcaTemplateState';

describe('commitLegacyVcaTemplateState', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        setTrackState({ tracks: [], selectedTrackId: null });
    });

    it('commits the legacy shape through one Arrangement-owned boundary', () => {
        const first = createTrack({ id: 'track-1', name: 'Kick', kind: 'audio' });
        const second = createTrack({ id: 'track-2', name: 'Bass', kind: 'midi' });

        commitLegacyVcaTemplateState({
            tracks: [first, second],
            selectedTrackId: second.id,
            groups: [
                {
                    id: 'vca-drums',
                    name: 'Drums',
                    gain: 0.75,
                    muted: true,
                    memberTrackIds: [first.id, first.id, 'missing-track'],
                },
                {
                    id: 'vca-other',
                    name: 'Other',
                    gain: 1,
                    muted: false,
                    memberTrackIds: [first.id, second.id],
                },
            ],
        });

        expect(getVcaGroupsState()).toEqual([
            { id: 'vca-drums', name: 'Drums', gain: 0.75, muted: true, trackIds: [first.id] },
            { id: 'vca-other', name: 'Other', gain: 1, muted: false, trackIds: [second.id] },
        ]);
        expect(getTrackById(first.id)?.vcaGroupId).toBe('vca-drums');
        expect(getTrackById(second.id)?.vcaGroupId).toBe('vca-other');
    });

    it('rejects duplicate group identities before either representation is written', () => {
        const existing = createTrack({ id: 'track-existing', name: 'Existing', kind: 'audio' });
        existing.vcaGroupId = 'vca-existing';
        setTrackState({ tracks: [existing], selectedTrackId: existing.id });
        setVcaGroupsState([
            {
                id: 'vca-existing',
                name: 'Existing',
                gain: 0.5,
                muted: false,
                trackIds: [existing.id],
            },
        ]);
        const incoming = createTrack({ id: 'track-incoming', name: 'Incoming', kind: 'midi' });

        expect(() =>
            commitLegacyVcaTemplateState({
                tracks: [incoming],
                selectedTrackId: incoming.id,
                groups: [
                    {
                        id: 'vca-duplicate',
                        name: 'First',
                        gain: 1,
                        muted: false,
                        memberTrackIds: [incoming.id],
                    },
                    {
                        id: 'vca-duplicate',
                        name: 'Second',
                        gain: 0.75,
                        muted: true,
                        memberTrackIds: [],
                    },
                ],
            })
        ).toThrow('Duplicate legacy VCA group id: vca-duplicate');
        expect(getVcaGroupsState()).toEqual([
            {
                id: 'vca-existing',
                name: 'Existing',
                gain: 0.5,
                muted: false,
                trackIds: [existing.id],
            },
        ]);
        expect(getTrackById(existing.id)?.vcaGroupId).toBe('vca-existing');
        expect(getTrackById(incoming.id)).toBeUndefined();
    });

    it('clears the vca group of a track that is not a member of any group', () => {
        const member = createTrack({ id: 'track-member', name: 'Kick', kind: 'audio' });
        // An unassigned track that previously carried a stale group id.
        const unassigned = createTrack({ id: 'track-unassigned', name: 'Bass', kind: 'audio' });
        unassigned.vcaGroupId = 'vca-stale';

        commitLegacyVcaTemplateState({
            tracks: [member, unassigned],
            selectedTrackId: member.id,
            groups: [
                {
                    id: 'vca-drums',
                    name: 'Drums',
                    gain: 1,
                    muted: false,
                    memberTrackIds: [member.id],
                },
            ],
        });

        expect(getTrackById(member.id)?.vcaGroupId).toBe('vca-drums');
        // The unassigned track has no owner -> its group id resets to null.
        expect(getTrackById(unassigned.id)?.vcaGroupId).toBeNull();
    });
});
