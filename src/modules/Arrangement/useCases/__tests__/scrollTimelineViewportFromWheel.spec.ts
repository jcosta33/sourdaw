import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scrollTimeline, setScrollY } from '../../stores/timelineViewStore';
import { scrollTimelineViewportFromWheel } from '../scrollTimelineViewportFromWheel';

const viewStoreMock = vi.hoisted(() => ({
    state: {
        scrollX: 0,
        scrollY: 40,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    },
}));

vi.mock('../../stores/timelineViewStore', () => ({
    scrollTimeline: vi.fn(),
    setScrollY: vi.fn(),
    timelineViewStore: {
        get value() {
            return viewStoreMock.state;
        },
    },
}));

describe('scrollTimelineViewportFromWheel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        viewStoreMock.state = {
            scrollX: 0,
            scrollY: 40,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
        };
    });

    it('should route shift wheel movement to horizontal timeline scroll', () => {
        scrollTimelineViewportFromWheel({ deltaX: 0, deltaY: 24, shiftKey: true, viewportHeight: 130 });

        expect(scrollTimeline).toHaveBeenCalledTimes(1);
        expect(scrollTimeline).toHaveBeenCalledWith(24);
        expect(setScrollY).not.toHaveBeenCalled();
    });

    it('should route dominant deltaX movement to horizontal timeline scroll', () => {
        scrollTimelineViewportFromWheel({ deltaX: -18, deltaY: 4, shiftKey: false, viewportHeight: 130 });

        expect(scrollTimeline).toHaveBeenCalledTimes(1);
        expect(scrollTimeline).toHaveBeenCalledWith(-18);
        expect(setScrollY).not.toHaveBeenCalled();
    });

    it('should route dominant deltaY movement to vertical timeline scroll', () => {
        scrollTimelineViewportFromWheel({ deltaX: 4, deltaY: 30, shiftKey: false, viewportHeight: 130 });

        expect(setScrollY).toHaveBeenCalledTimes(1);
        expect(setScrollY).toHaveBeenCalledWith(70, 130);
        expect(scrollTimeline).not.toHaveBeenCalled();
    });

    it('should clamp vertical wheel movement at zero before writing scrollY', () => {
        scrollTimelineViewportFromWheel({ deltaX: 0, deltaY: -80, shiftKey: false, viewportHeight: 130 });

        expect(setScrollY).toHaveBeenCalledTimes(1);
        expect(setScrollY).toHaveBeenCalledWith(0, 130);
        expect(scrollTimeline).not.toHaveBeenCalled();
    });

    it('treats an absent view state as a zero vertical scroll offset', () => {
        viewStoreMock.state = null as unknown as typeof viewStoreMock.state;

        scrollTimelineViewportFromWheel({ deltaX: 0, deltaY: 30, shiftKey: false, viewportHeight: 130 });

        // No prior scrollY -> the delta alone becomes the new offset.
        expect(setScrollY).toHaveBeenCalledTimes(1);
        expect(setScrollY).toHaveBeenCalledWith(30, 130);
        expect(scrollTimeline).not.toHaveBeenCalled();
    });

    // Regression (F7): the caller's own real viewport height must reach
    // `setScrollY` as an explicit override on every vertical-scroll call, not
    // just some of them — otherwise a caller with no shared-store height
    // report (the automation panel) would silently clamp against zero, or
    // against whatever another view last wrote.
    it('forwards the caller-supplied viewportHeight on every vertical scroll call', () => {
        scrollTimelineViewportFromWheel({ deltaX: 0, deltaY: 10, shiftKey: false, viewportHeight: 265 });

        expect(setScrollY).toHaveBeenCalledWith(50, 265);
    });
});
