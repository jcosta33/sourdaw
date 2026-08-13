import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { scrollTimelineViewportFromWheel } from '../../useCases/scrollTimelineViewportFromWheel';
import {
    timelineViewStore,
    zoomTimeline,
    scrollTimeline,
    setScrollX,
    setAutoScroll,
    toggleAutoScroll,
    setScrollY,
    setTimelineViewportHeight,
} from '../timelineViewStore';
import { trackStore } from '../trackStore';

describe('timelineViewStore view helpers', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should clamp zoomTimeline pixelsPerBeat between 2 and 80', () => {
        zoomTimeline(100);
        expect(timelineViewStore.value?.pixelsPerBeat).toBe(80);
        zoomTimeline(-200);
        expect(timelineViewStore.value?.pixelsPerBeat).toBe(2);
    });

    it('should move scrollX with scrollTimeline and not go below zero', () => {
        scrollTimeline(24);
        expect(timelineViewStore.value?.scrollX).toBe(24);
        scrollTimeline(-100);
        expect(timelineViewStore.value?.scrollX).toBe(0);
    });

    it('should clamp setScrollX to non-negative values', () => {
        setScrollX(10);
        setScrollX(-5);
        expect(timelineViewStore.value?.scrollX).toBe(0);
    });

    it('should set and toggle autoScrollEnabled', () => {
        setAutoScroll(false);
        expect(timelineViewStore.value?.autoScrollEnabled).toBe(false);
        toggleAutoScroll();
        expect(timelineViewStore.value?.autoScrollEnabled).toBe(true);
    });

    it('should clamp setScrollY when there are no tracks', () => {
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(0);
    });

    // Regression (F7): setScrollY used to take an optional `viewportHeight`
    // argument that defaulted to a hardcoded 200px, so two of its three
    // callers — which omitted the argument — clamped against a viewport that
    // did not match their real container. The viewport height is now part of
    // the store's own state, written once by whichever view actually knows
    // its real size, so every `setScrollY` call clamps against the same,
    // caller-independent value.
    it('should clamp setScrollY using the viewport height last reported via setTimelineViewportHeight', () => {
        trackStore.set({
            tracks: [{ id: 'a', kind: 'audio', height: 100 } as any, { id: 'b', kind: 'audio', height: 100 } as any],
            selectedTrackId: null,
        });

        // total content height = 200, viewport = 50 → maxY = 150.
        setTimelineViewportHeight(50);
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(150);

        // A larger viewport shrinks the scroll ceiling.
        setTimelineViewportHeight(80);
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(120);
    });

    it('should not write viewport height when the store is null', () => {
        timelineViewStore.set(null);
        setTimelineViewportHeight(50);
        expect(timelineViewStore.value).toBeNull();
    });

    it('should not throw when store is null', () => {
        timelineViewStore.set(null);
        zoomTimeline(1);
        scrollTimeline(1);
        setScrollX(0);
        setAutoScroll(true);
        toggleAutoScroll();
        setScrollY(0);
        expect(timelineViewStore.value).toBeNull();
    });
});

// setScrollY derives the vertical scroll ceiling from the project's non-master
// track heights. The domain contract: the master track renders outside the
// scrollable track list (it must never count toward the scrollable height), a
// track missing a height falls back to 64px, and the ceiling is clamped so the
// last track can scroll fully into view but no further.
describe('setScrollY track-height ceiling', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('excludes the master track from the scrollable height ceiling', () => {
        // Two audio tracks (100px each) + a 9999px master. The master is pinned
        // outside the scroll viewport, so it must not inflate the ceiling.
        trackStore.set({
            tracks: [
                { id: 'a', kind: 'audio', height: 100 } as any,
                { id: 'b', kind: 'audio', height: 100 } as any,
                { id: 'master', kind: 'master', height: 9999 } as any,
            ],
            selectedTrackId: null,
        });

        // total scrollable height = 200 (audio only), viewport = 50 -> maxY 150.
        setTimelineViewportHeight(50);
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(150);
    });

    it('defaults a missing track height to 64px', () => {
        // Track with no height field relies on the 64px fallback so an empty
        // height never collapses the ceiling to zero.
        trackStore.set({
            tracks: [{ id: 'a', kind: 'audio' } as any, { id: 'b', kind: 'audio', height: 64 } as any],
            selectedTrackId: null,
        });

        // total = 64 (fallback) + 64 (explicit) = 128, viewport = 0 -> maxY 128.
        setTimelineViewportHeight(0);
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(128);
    });

    it('treats a null trackStore as an empty track list (ceiling 0)', () => {
        vi.spyOn(trackStore, 'value', 'get').mockReturnValue(null);
        // No tracks -> totalHeight 0 -> maxY 0 -> clamped to 0.
        setTimelineViewportHeight(50);
        setScrollY(500);
        expect(timelineViewStore.value?.scrollY).toBe(0);
        vi.restoreAllMocks();
    });

    it('does not write when the clamped value equals the current scrollY', () => {
        trackStore.set({
            tracks: [{ id: 'a', kind: 'audio', height: 100 } as any],
            selectedTrackId: null,
        });
        // Pre-position at the only reachable value (0) and ask for 0 again.
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 50,
        });
        const writeSpy = vi.spyOn(timelineViewStore, 'set');

        setScrollY(0);

        // ceiling 0 -> clamped 0 == current 0 -> no store write.
        expect(writeSpy).not.toHaveBeenCalled();
    });
});

// Regression (F7, second call site): `viewportHeight` used to be a single
// field on the store, written only by `TrackListView`. A second scrollable
// view — the automation panel, driven through
// `scrollTimelineViewportFromWheel` — has no `ResizeObserver` of its own and
// clamped against whatever the track list last reported, so its scroll
// ceiling depended on an unrelated view's size (and, worse, on a mounted
// `TrackListView` re-syncing its own real `scrollTop` to that shared
// `scrollY`, letting the automation panel desync the track list's actual
// scroll position). `scrollTimelineViewportFromWheel` now takes the caller's
// own real height as a required input and forwards it to `setScrollY` as a
// per-call override, so each view's clamp uses its own height regardless of
// what any other mounted view reported.
describe('scrollTimelineViewportFromWheel viewport isolation (F7)', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it("clamps the automation panel's own wheel scroll against its own reported height, not the track list's", () => {
        // 400px of scrollable track content.
        trackStore.set({
            tracks: [{ id: 'a', kind: 'audio', height: 200 } as any, { id: 'b', kind: 'audio', height: 200 } as any],
            selectedTrackId: null,
        });

        // TrackListView is mounted at 500px tall (taller than all content)
        // and reports it the way it always does.
        setTimelineViewportHeight(500);

        // The automation panel is mounted at a real, much smaller 130px and
        // supplies that height itself on every wheel event, instead of
        // reading the track list's shared field.
        scrollTimelineViewportFromWheel({ deltaX: 0, deltaY: 1000, shiftKey: false, viewportHeight: 130 });

        // Its own ceiling: totalHeight(400) - viewportHeight(130) = 270.
        // Before this fix it inherited the track list's viewport (500 > 400
        // content), clamping the ceiling to 0 regardless of how far the
        // automation panel actually scrolled.
        expect(timelineViewStore.value?.scrollY).toBe(270);

        // The track list's own field is untouched by the automation panel's
        // call — the two views' heights stay independent.
        expect(timelineViewStore.value?.viewportHeight).toBe(500);
    });
});
