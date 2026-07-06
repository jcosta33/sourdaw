import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setScrollX } from '../../stores/timelineViewStore';
import { setTimelineHorizontalScrollbarScrollX } from '../setTimelineHorizontalScrollbarScrollX';

vi.mock('../../stores/timelineViewStore', () => ({
    setScrollX: vi.fn(),
}));

describe('setTimelineHorizontalScrollbarScrollX', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should clamp horizontal scrollbar scroll above the maximum before writing', () => {
        setTimelineHorizontalScrollbarScrollX({ scrollX: 120, maxScrollX: 80 });

        expect(setScrollX).toHaveBeenCalledTimes(1);
        expect(setScrollX).toHaveBeenCalledWith(80);
    });

    it('should clamp horizontal scrollbar scroll below zero before writing', () => {
        setTimelineHorizontalScrollbarScrollX({ scrollX: -24, maxScrollX: 80 });

        expect(setScrollX).toHaveBeenCalledTimes(1);
        expect(setScrollX).toHaveBeenCalledWith(0);
    });

    it('should write in-range horizontal scrollbar scroll unchanged', () => {
        setTimelineHorizontalScrollbarScrollX({ scrollX: 32, maxScrollX: 80 });

        expect(setScrollX).toHaveBeenCalledTimes(1);
        expect(setScrollX).toHaveBeenCalledWith(32);
    });
});
