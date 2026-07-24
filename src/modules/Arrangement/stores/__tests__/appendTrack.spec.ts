import { beforeEach, describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { appendTrack } from '../appendTrack';
import { defaultTrackState, trackStore } from '../trackStore';

describe('appendTrack', () => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
    });

    it('appends the track to the store and selects it', () => {
        const existing = TrackDummy.create({ id: 't-existing' });
        trackStore.set({ tracks: [existing], selectedTrackId: 't-existing', ghostClips: [] });

        const newTrack = TrackDummy.create({ id: 't-new' });
        appendTrack(newTrack);

        const state = trackStore.value;
        expect(state?.tracks).toHaveLength(2);
        expect(state?.tracks[1]?.id).toBe('t-new');
        expect(state?.selectedTrackId).toBe('t-new');
    });

    it('is a no-op when the store has not loaded', () => {
        trackStore.set(null);

        appendTrack(TrackDummy.create({ id: 't-new' }));

        expect(trackStore.value).toBeNull();
    });
});
