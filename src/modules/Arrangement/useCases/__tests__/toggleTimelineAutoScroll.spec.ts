import { describe, it, expect, vi } from 'vitest';

import { toggleAutoScroll } from '../../stores/timelineViewStore';
import { toggleTimelineAutoScroll } from '../toggleTimelineAutoScroll';

vi.mock('../../stores/timelineViewStore', () => ({
    toggleAutoScroll: vi.fn(),
}));

describe('toggleTimelineAutoScroll', () => {
    it('should route timeline auto-scroll toggles through the timeline view store helper', () => {
        toggleTimelineAutoScroll();

        expect(toggleAutoScroll).toHaveBeenCalledTimes(1);
        expect(toggleAutoScroll).toHaveBeenCalledWith();
    });
});
