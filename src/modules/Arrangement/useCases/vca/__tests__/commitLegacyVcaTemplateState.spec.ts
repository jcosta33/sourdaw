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
});
