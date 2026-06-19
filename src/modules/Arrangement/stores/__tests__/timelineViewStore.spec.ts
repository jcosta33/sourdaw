import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    timelineViewStore,
    zoomTimeline,
    scrollTimeline,
    setScrollX,
    setAutoScroll,
    toggleAutoScroll,
    setScrollY,
} from '../timelineViewStore';
import { trackStore } from '../trackStore';

describe('timelineViewStore view helpers', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
        });
        trackStore.set({ tracks: [], selectedTrackId: null } as any);
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null } as any);
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

    // Regression: setScrollY must clamp against the viewport height the caller
    // passes, not its hardcoded 200px default. The gesture hook already knows
    // the real canvas height; double-clamping against 200 produced a wrong
    // scroll ceiling.
    it('should clamp setScrollY using the caller-provided viewport height', () => {
        trackStore.set({
            tracks: [{ id: 'a', kind: 'audio', height: 100 } as any, { id: 'b', kind: 'audio', height: 100 } as any],
            selectedTrackId: null,
        } as any);

        // total content height = 200, viewport = 50 → maxY = 150.
        setScrollY(500, 50);
        expect(timelineViewStore.value?.scrollY).toBe(150);

        // A larger viewport shrinks the scroll ceiling.
        setScrollY(500, 80);
        expect(timelineViewStore.value?.scrollY).toBe(120);
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
