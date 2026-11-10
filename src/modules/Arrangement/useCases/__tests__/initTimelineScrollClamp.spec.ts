import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { setScrollY, setTimelineViewportHeight, timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { initTimelineScrollClamp } from '../initTimelineScrollClamp';

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'kind'>): Track {
    return {
        ...createTrack({
            id: overrides.id,
            kind: overrides.kind,
            name: overrides.id,
            initialDeviceId: `${overrides.id}-device`,
            initialAlternativeId: `${overrides.id}-alternative`,
        }),
        ...overrides,
    };
}

describe('initTimelineScrollClamp', () => {
    let stop: () => void;

    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
        trackStore.set({ tracks: [], selectedTrackId: null });
        stop = initTimelineScrollClamp();
    });

    afterEach(() => {
        stop();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('pulls scrollY back to the new maximum when tracks are deleted while scrolled to the end', () => {
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(150);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(150);

        trackStore.set({ tracks: tracks.slice(0, 2), selectedTrackId: null });

        expect(timelineViewStore.value?.scrollY).toBe(50);
    });

    it('pulls scrollY back when a folder collapses and its children leave the layout', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', collapsed: false }),
            makeTrack({ id: 'in-1', kind: 'audio', parentId: 'folder', height: 100 }),
            makeTrack({ id: 'in-2', kind: 'audio', parentId: 'folder', height: 100 }),
        ];
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(126);

        trackStore.set({
            tracks: tracks.map((track) => (track.id === 'folder' ? { ...track, collapsed: true } : track)),
            selectedTrackId: null,
        });

        // Only the 26px folder row remains, which fits the 100px viewport.
        expect(timelineViewStore.value?.scrollY).toBe(0);
    });

    it('leaves an in-range scrollY alone when tracks change', () => {
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(30);

        trackStore.set({
            tracks: [...tracks, makeTrack({ id: 'd', kind: 'audio', height: 100 })],
            selectedTrackId: null,
        });

        expect(timelineViewStore.value?.scrollY).toBe(30);
    });

    it('stops clamping once unsubscribed', () => {
        const tracks = ['a', 'b'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(1000);
        stop();

        trackStore.set({ tracks: [], selectedTrackId: null });

        expect(timelineViewStore.value?.scrollY).toBe(100);
    });
});
