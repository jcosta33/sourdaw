import { describe, it, expect, beforeEach, vi } from 'vitest';

import { beginClipDrag } from '../beginClipDrag';

const mockHitTestClip = vi.fn<(...args: unknown[]) => { clipId: string; trackId: string } | null>();
vi.mock('../hitTestClip/hitTestClip', () => ({
    hitTestClip: (...args: unknown[]) => mockHitTestClip(...args),
}));

let mockTimelineViewValue: { pixelsPerBeat: number; scrollX: number; scrollY: number } | null = null;
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return mockTimelineViewValue;
        },
    },
}));

let mockTrackValue: {
    tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[];
    selectedTrackId: string | null;
} | null = null;
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mockTrackValue;
        },
    },
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
