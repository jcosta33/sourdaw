import { afterEach, describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { defaultTimelineEditingState, timelineEditingStore } from '../../stores/timelineEditingStore';
import { trackStore } from '../../stores/trackStore';
import { readShownSelectedTrackId } from '../readShownSelectedTrackId';

describe('readShownSelectedTrackId', () => {
    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('is null without a selection', () => {
        trackStore.set({ tracks: [TrackDummy.create({ id: 'a' })], selectedTrackId: null });

        expect(readShownSelectedTrackId()).toBeNull();
    });

    it('returns a shown selected track', () => {
        trackStore.set({ tracks: [TrackDummy.create({ id: 'a' })], selectedTrackId: 'a' });

        expect(readShownSelectedTrackId()).toBe('a');
    });

    it('is null for a hidden selected track, or one under a hidden folder, until hidden tracks are shown', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'a', hidden: true }),
                TrackDummy.create({ id: 'folder', kind: 'folder', hidden: true }),
                TrackDummy.create({ id: 'child', parentId: 'folder' }),
            ],
            selectedTrackId: 'a',
        });
        expect(readShownSelectedTrackId()).toBeNull();
        trackStore.set({ ...trackStore.value!, selectedTrackId: 'child' });
        expect(readShownSelectedTrackId()).toBeNull();

        timelineEditingStore.set({ ...defaultTimelineEditingState, showHiddenTracks: true });
        expect(readShownSelectedTrackId()).toBe('child');
    });
});
