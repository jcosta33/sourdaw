import { describe, it, expect, vi } from 'vitest';

import { setAutoScroll } from '../../stores/timelineViewStore';
import { setTimelineMinimapAutoScroll } from '../setTimelineMinimapAutoScroll';

vi.mock('../../stores/timelineViewStore', () => ({
    setAutoScroll: vi.fn(),
}));

describe('setTimelineMinimapAutoScroll', () => {
    it('should route minimap auto-scroll changes through the timeline view store helper', () => {
        setTimelineMinimapAutoScroll(false);

        expect(setAutoScroll).toHaveBeenCalledTimes(1);
        expect(setAutoScroll).toHaveBeenCalledWith(false);
    });
});
