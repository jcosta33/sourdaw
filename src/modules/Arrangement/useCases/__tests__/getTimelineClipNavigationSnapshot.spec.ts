import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { defaultTimelineEditingState, timelineEditingStore } from '../../stores/timelineEditingStore';
import { trackStore } from '../../stores/trackStore';
import { getTimelineClipNavigationSnapshot } from '../getTimelineClipNavigationSnapshot';

function clip(id: string, trackId: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

describe('getTimelineClipNavigationSnapshot', () => {
    beforeEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'shown', clips: [clip('shown-clip', 'shown')] }),
                TrackDummy.create({ id: 'hidden', hidden: true, clips: [clip('hidden-clip', 'hidden')] }),
            ],
            selectedTrackId: null,
        });
    });

    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('lists no clip of a hidden track until hidden tracks are shown, with the tracks unchanged', () => {
        expect(getTimelineClipNavigationSnapshot().map((item) => item.key)).toEqual(['shown:shown-clip']);

        timelineEditingStore.set({ ...defaultTimelineEditingState, showHiddenTracks: true });
        expect(getTimelineClipNavigationSnapshot().map((item) => item.key)).toEqual([
            'shown:shown-clip',
            'hidden:hidden-clip',
        ]);

        timelineEditingStore.set(defaultTimelineEditingState);
        expect(getTimelineClipNavigationSnapshot().map((item) => item.key)).toEqual(['shown:shown-clip']);
    });

    it('returns the same snapshot while neither the tracks nor the flag change', () => {
        expect(getTimelineClipNavigationSnapshot()).toBe(getTimelineClipNavigationSnapshot());
    });
});
