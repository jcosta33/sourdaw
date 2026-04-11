import { describe, it, expect, beforeEach, vi } from 'vitest';
import { snapToGridOrClips } from '../snapToGridOrClips';

let mockTrackValue: any = null;
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { get value() { return mockTrackValue; } }
}));

const mockSnapToGrid = vi.fn();
vi.mock('../snapToGrid', () => ({
    snapToGrid: (...args: any[]) => mockSnapToGrid(...args)
}));

describe('snapToGridOrClips', () => {
    beforeEach(() => {
        mockTrackValue = null;
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
});
