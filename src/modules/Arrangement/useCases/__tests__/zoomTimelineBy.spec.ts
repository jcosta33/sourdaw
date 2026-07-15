import { describe, expect, it, vi } from 'vitest';

import { zoomTimeline } from '../../stores/timelineViewStore';
import { zoomTimelineBy } from '../zoomTimelineBy';

vi.mock('../../stores/timelineViewStore', () => ({
    zoomTimeline: vi.fn(),
}));

describe('zoomTimelineBy', () => {
    it('routes the zoom delta through the owning timeline store', () => {
        zoomTimelineBy(4);

        expect(zoomTimeline).toHaveBeenCalledWith(4);
    });
});
