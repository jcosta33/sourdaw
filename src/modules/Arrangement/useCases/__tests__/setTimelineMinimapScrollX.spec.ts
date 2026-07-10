import { describe, it, expect, vi } from 'vitest';

import { setScrollX } from '../../stores/timelineViewStore';
import { setTimelineMinimapScrollX } from '../setTimelineMinimapScrollX';

vi.mock('../../stores/timelineViewStore', () => ({
    setScrollX: vi.fn(),
}));

describe('setTimelineMinimapScrollX', () => {
    it('should route minimap horizontal scroll through the timeline view store helper', () => {
        setTimelineMinimapScrollX(-24);

        expect(setScrollX).toHaveBeenCalledTimes(1);
        expect(setScrollX).toHaveBeenCalledWith(-24);
    });
});
