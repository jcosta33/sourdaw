import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scrollTimeline } from '../../stores/timelineViewStore';
import { scrollTimelineViewportHorizontallyFromWheel } from '../scrollTimelineViewportHorizontallyFromWheel';

vi.mock('../../stores/timelineViewStore', () => ({
    scrollTimeline: vi.fn(),
}));

describe('scrollTimelineViewportHorizontallyFromWheel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should route shift wheel movement to horizontal timeline scroll', () => {
        scrollTimelineViewportHorizontallyFromWheel({ deltaX: 0, deltaY: 24, shiftKey: true });

        expect(scrollTimeline).toHaveBeenCalledTimes(1);
        expect(scrollTimeline).toHaveBeenCalledWith(24);
    });

    it('should route dominant deltaX movement to horizontal timeline scroll', () => {
        scrollTimelineViewportHorizontallyFromWheel({ deltaX: -18, deltaY: 4, shiftKey: false });

        expect(scrollTimeline).toHaveBeenCalledTimes(1);
        expect(scrollTimeline).toHaveBeenCalledWith(-18);
    });

    it('should ignore dominant deltaY movement', () => {
        scrollTimelineViewportHorizontallyFromWheel({ deltaX: 4, deltaY: 30, shiftKey: false });

        expect(scrollTimeline).not.toHaveBeenCalled();
    });
});
