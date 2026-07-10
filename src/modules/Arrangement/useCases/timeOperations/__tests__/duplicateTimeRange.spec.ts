import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackState, setTrackState, insertTime } = vi.hoisted(() => ({
    trackState: {
        value: {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'inside', startBeat: 4, endBeat: 6 },
                        { id: 'after-inserted-copy', startBeat: 8, endBeat: 10 },
                    ],
                },
            ],
        },
    },
    setTrackState: vi.fn(),
    insertTime: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: () => trackState.value,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState,
}));

vi.mock('../insertTime', () => ({
    insertTime,
}));

import { duplicateTimeRange } from '../duplicateTimeRange';

describe('duplicateTimeRange', () => {
    beforeEach(() => {
        trackState.value = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'inside', startBeat: 4, endBeat: 6 },
                        { id: 'after-inserted-copy', startBeat: 8, endBeat: 10 },
                    ],
                },
            ],
        };
        setTrackState.mockClear();
        insertTime.mockClear();
    });

    it('should export duplicateTimeRange', () => {
        expect(duplicateTimeRange).toBeDefined();
        const time = typeof duplicateTimeRange;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('should insert space and duplicate clips in the selected range', () => {
        duplicateTimeRange(4, 6);

        expect(insertTime).toHaveBeenCalledWith(6, 2);
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'inside', startBeat: 4, endBeat: 6 },
                        { id: 'after-inserted-copy', startBeat: 8, endBeat: 10 },
                        {
                            id: expect.stringMatching(/^clip-dup-/),
                            startBeat: 6,
                            endBeat: 8,
                        },
                    ],
                },
            ],
        });
    });
});
