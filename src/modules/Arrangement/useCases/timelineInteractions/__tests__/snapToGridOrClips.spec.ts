import { describe, it, expect, beforeEach, vi } from 'vitest';

import { snapToGridOrClips } from '../snapToGridOrClips';

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

let mockPixelsPerBeat = 12;
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return { pixelsPerBeat: mockPixelsPerBeat };
        },
    },
}));

const mockSnapToGrid = vi.fn<(beat: number) => number>();
vi.mock('../snapToGrid', () => ({
    snapToGrid: (beat: number) => mockSnapToGrid(beat),
}));

describe('snapToGridOrClips', () => {
    beforeEach(() => {
        mockTrackValue = null;
        mockPixelsPerBeat = 12;
        mockSnapToGrid.mockReset();
    });

    it('snaps to a nearby clip edge before grid', () => {
        mockTrackValue = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'a', startBeat: 0, endBeat: 4 },
                        { id: 'b', startBeat: 8, endBeat: 12 },
                    ],
                },
            ],
            selectedTrackId: null,
        };
        mockSnapToGrid.mockReturnValue(99);

        expect(snapToGridOrClips(0.1, 't1')).toBe(0);
        expect(snapToGridOrClips(3.9, 't1')).toBe(4);
    });

    it('excludes a clip id from edge snapping', () => {
        mockTrackValue = {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'only', startBeat: 0, endBeat: 4 }],
                },
            ],
            selectedTrackId: null,
        };
        mockSnapToGrid.mockImplementation((beat: number) => beat);

        expect(snapToGridOrClips(0.1, 't1', 'only')).toBe(0.1);
    });

    it('delegates to snapToGrid when no clip edge matches', () => {
        mockTrackValue = {
            tracks: [{ id: 't1', clips: [] }],
            selectedTrackId: null,
        };
        mockSnapToGrid.mockImplementation((beat: number) => Math.round(beat));

        expect(snapToGridOrClips(1.4, 't1')).toBe(1);
        expect(mockSnapToGrid).toHaveBeenCalledWith(1.4);
    });

    it('scales the snap radius with zoom: a fixed pixel radius shrinks in beats when zoomed in', () => {
        mockTrackValue = {
            tracks: [{ id: 't1', clips: [{ id: 'a', startBeat: 0, endBeat: 4 }] }],
            selectedTrackId: null,
        };
        // Sentinel: if we DON'T snap to the clip edge, this is returned instead.
        mockSnapToGrid.mockReturnValue(99);

        // SNAP_THRESHOLD_PX is 3. At 12px/beat the radius is 0.25 beats, so 0.2
        // snaps to the edge at 0.
        mockPixelsPerBeat = 12;
        expect(snapToGridOrClips(0.2, 't1')).toBe(0);

        // Zoom way in to 60px/beat: radius is 3/60 = 0.05 beats, so the same
        // 0.2-beat distance is now outside the radius and does NOT snap.
        mockPixelsPerBeat = 60;
        expect(snapToGridOrClips(0.2, 't1')).toBe(99);
    });

    it('widens the snap radius in beats when zoomed out', () => {
        mockTrackValue = {
            tracks: [{ id: 't1', clips: [{ id: 'a', startBeat: 0, endBeat: 4 }] }],
            selectedTrackId: null,
        };
        mockSnapToGrid.mockReturnValue(99);

        // Zoom out to 3px/beat: radius is 3/3 = 1 beat, so 0.9 beats away snaps.
        mockPixelsPerBeat = 3;
        expect(snapToGridOrClips(0.9, 't1')).toBe(0);
    });
});
