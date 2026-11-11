import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../models/Track';
import {
    setAutoScroll,
    setScrollX,
    setScrollY,
    setTimelineViewportSize,
    setTimelineZoom,
    timelineViewStore,
} from '../../stores/timelineViewStore';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { addClip } from '../clip/addClip';
import { getTimelineHorizontalContentWidth } from '../getTimelineHorizontalContentWidth';
import { initTimelineScrollClamp } from '../initTimelineScrollClamp';
import { resetTimelineWorkingView, restoreTimelineWorkingView } from '../projectWorkingView';

function addTrackWithClip(id: string, endBeat: number): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: [...tracks, createTrack({ id, name: id, kind: 'audio' })],
        selectedTrackId: null,
    });
    const clip = addClip({ id: `${id}-clip`, trackId: id, name: id, startBeat: 0, endBeat, type: 'audio' });
    if (!clip) {
        throw new Error('Expected the timeline fixture clip to be added');
    }
}

describe('project timeline working view', () => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportWidth: 0,
            viewportHeight: 0,
        });
    });

    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
    });

    it('uses the existing 256-beat minimum extent and the last clip when it is longer', () => {
        expect(getTimelineHorizontalContentWidth([], 10)).toBe(2560);
        addTrackWithClip('long', 400);

        expect(getTimelineHorizontalContentWidth(trackStore.value?.tracks ?? [], 10)).toBe(4000);
    });

    it('includes clips drawn in visible variation lanes without counting the stale active copy', () => {
        addTrackWithClip('main', 8);
        const track = trackStore.value?.tracks[0];
        const activeAlternative = track?.alternatives[0];
        const mainClip = track?.clips[0];
        if (!track || !activeAlternative || !mainClip) {
            throw new Error('Expected the variation-lane fixture track');
        }
        const laneTrack = {
            ...track,
            showVariationLanes: true,
            alternatives: [
                { ...activeAlternative, clips: [{ ...mainClip, id: 'stale-active', endBeat: 900 }] },
                { id: 'inactive', name: 'Inactive', clips: [{ ...mainClip, id: 'lane-long', endBeat: 400 }] },
            ],
        };
        trackStore.set({ tracks: [laneTrack], selectedTrackId: null });

        expect(getTimelineHorizontalContentWidth([laneTrack], 10)).toBe(4000);
        expect(getTimelineHorizontalContentWidth([{ ...laneTrack, showVariationLanes: false }], 10)).toBe(2560);
    });

    it('computes a large arrangement extent without spreading every clip into Math.max', () => {
        const tracks = [
            {
                clips: Array.from({ length: 200_000 }, (_, index) => ({ endBeat: index })),
            },
        ];

        expect(getTimelineHorizontalContentWidth(tracks, 10)).toBe(1_999_990);
    });

    it('keeps legacy lower-only clamping while viewport width is unknown', () => {
        setScrollX(9000);

        expect(timelineViewStore.value?.scrollX).toBe(9000);
    });

    it('clamps horizontal scroll against arrangement extent and the measured viewport', () => {
        addTrackWithClip('long', 400);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });

        setScrollX(9000);

        expect(timelineViewStore.value?.scrollX).toBe(4300);
    });

    it('reclamps both offsets when the viewport grows', () => {
        addTrackWithClip('a', 400);
        addTrackWithClip('b', 8);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });
        setScrollX(9000);
        setScrollY(150);

        setTimelineViewportSize({ viewportWidth: 1000, viewportHeight: 150 });

        expect(timelineViewStore.value).toMatchObject({
            viewportWidth: 1000,
            viewportHeight: 150,
            scrollX: 3800,
            scrollY: 10,
        });
    });

    it('reclamps horizontal scroll when the arrangement extent shrinks', () => {
        addTrackWithClip('long', 400);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });
        setScrollX(9000);
        const stop = initTimelineScrollClamp();

        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) => ({ ...track, clips: [] })),
            selectedTrackId: null,
        });

        expect(timelineViewStore.value?.scrollX).toBe(2572);
        stop();
    });

    it('restores zoom and both offsets through the same clamps', () => {
        addTrackWithClip('a', 400);
        addTrackWithClip('b', 8);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });
        setAutoScroll(false);

        restoreTimelineWorkingView({ scrollX: 9000, scrollY: 900, pixelsPerBeat: 10 });

        expect(timelineViewStore.value).toMatchObject({
            scrollX: 3500,
            scrollY: 110,
            pixelsPerBeat: 10,
            autoScrollEnabled: false,
            viewportWidth: 500,
            viewportHeight: 50,
        });
    });

    it('can defer restored offsets to the next real viewport measurement', () => {
        addTrackWithClip('a', 400);
        addTrackWithClip('b', 8);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });

        restoreTimelineWorkingView({ scrollX: 9000, scrollY: 900, pixelsPerBeat: 10 }, { deferViewportClamp: true });

        expect(timelineViewStore.value).toMatchObject({ scrollX: 9000, scrollY: 900, pixelsPerBeat: 10 });

        setTimelineViewportSize({ viewportWidth: 1000, viewportHeight: 150 });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 3000, scrollY: 10 });
    });

    it('clamps restored zoom and reset offsets without discarding viewport measurements', () => {
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });
        setAutoScroll(false);

        restoreTimelineWorkingView({ scrollX: 20, scrollY: 0, pixelsPerBeat: 1000 });
        expect(timelineViewStore.value?.pixelsPerBeat).toBe(80);

        resetTimelineWorkingView();

        expect(timelineViewStore.value).toMatchObject({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportWidth: 500,
            viewportHeight: 50,
        });
    });

    it('reclamps an existing offset when zoom reduces the horizontal extent', () => {
        addTrackWithClip('long', 400);
        setTimelineViewportSize({ viewportWidth: 500, viewportHeight: 50 });
        setTimelineZoom(10, 350);
        expect(timelineViewStore.value?.scrollX).toBe(3500);

        setTimelineZoom(5, 350);

        expect(timelineViewStore.value?.scrollX).toBe(1500);
    });
});
