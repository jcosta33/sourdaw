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

    it('returns null when the timeline view store has not loaded', () => {
        mockHitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mockTimelineViewValue = null;
        mockTrackValue = { tracks: [], selectedTrackId: null };

        expect(beginClipDrag(0, 0)).toBeNull();
    });

    it('returns null when the track store has not loaded', () => {
        mockHitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue = null;

        expect(beginClipDrag(0, 0)).toBeNull();
    });

    it('returns null when the hit clip is absent from the track store', () => {
        // hitTestClip resolves an id, but the track/clip no longer exists in the
        // store (torn down between the hit and the drag start).
        mockHitTestClip.mockReturnValue({ clipId: 'ghost', trackId: 't1' });
        mockTimelineViewValue = { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 };
        mockTrackValue = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 8 }] }],
            selectedTrackId: null,
        };

        expect(beginClipDrag(0, 0)).toBeNull();
    });
});
