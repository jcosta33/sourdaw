import { describe, it, expect, beforeEach, vi } from 'vitest';
import { beginClipDrag } from '../beginClipDrag';

const mockHitTestClip = vi.fn();
vi.mock('../hitTestClip/hitTestClip', () => ({
    hitTestClip: (...args: any[]) => mockHitTestClip(...args)
}));

let mockTimelineViewValue: any = null;
vi.mock('#/modules/Arrangement/stores/timelineViewStore', () => ({
    timelineViewStore: { get value() { return mockTimelineViewValue; } }
}));

let mockTrackValue: any = null;
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { get value() { return mockTrackValue; } }
}));

describe('beginClipDrag', () => {
    beforeEach(() => {
        mockHitTestClip.mockReset();
        mockTimelineViewValue = null;
        mockTrackValue = null;
    });

    it('returns drag state from hit test and clip bounds', () => {
        mockHitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue = {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', startBeat: 0, endBeat: 8 }],
                },
            ],
            selectedTrackId: null,
        };

        const state = beginClipDrag(20, 12, 'move');
        expect(state).toEqual({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 8,
            offsetBeat: 2,
            mode: 'move',
        });
    });

    it('returns null when hitTestClip misses', () => {
        mockHitTestClip.mockReturnValue(null);
        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue = { tracks: [], selectedTrackId: null };

        expect(beginClipDrag(0, 0)).toBeNull();
    });
});
