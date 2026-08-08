import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFitClipToBeats } from '../handleFitClipToBeats';

const mocks = vi.hoisted(() => ({
    fitClipToBeats: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/fitClipToBeats', () => ({
    fitClipToBeats: mocks.fitClipToBeats,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleFitClipToBeats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    clips: [
                        {
                            id: 'c1',
                            name: 'Verse Lead',
                            startBeat: 2,
                            endBeat: 10,
                            stretchRatio: 1.5,
                            stretchMode: 'off',
                        },
                    ],
                },
            ],
        });
    });

    it('executes fitClipToBeats with the provided payload', () => {
        void handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'c1', targetBeats: 8 },
        });

        expect(mocks.fitClipToBeats).toHaveBeenCalledWith('c1', 8);
    });

    it('provides a description reflecting the target beats', () => {
        const desc = handleFitClipToBeats.describe({
            type: 'fitClipToBeats',
            payload: { clipId: 'c1', targetBeats: 8 },
        });
        expect(desc.label).toBe('Fit clip "Verse Lead" (c1) to 8 beats');
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipStretchState',
            payload: {
                clipId: 'c1',
                expected: {
                    startBeat: 2,
                    endBeat: 10,
                    mode: { present: true, value: 'repitch' },
                    ratio: { present: true, value: 1.5 },
                },
                replacement: {
                    startBeat: 2,
                    endBeat: 10,
                    mode: { present: true, value: 'off' },
                    ratio: { present: true, value: 1.5 },
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreClipStretchState',
            payload: {
                clipId: 'c1',
                expected: desc.inverseAction?.payload.replacement,
                replacement: desc.inverseAction?.payload.expected,
            },
        });
    });

    it('treats an exact repeated fit as a no-op but not a fit that enables repitch', () => {
        mocks.getTrackStoreState.mockReturnValueOnce({
            tracks: [
                {
                    clips: [
                        {
                            id: 'c1',
                            name: 'Verse Lead',
                            startBeat: 2,
                            endBeat: 10,
                            stretchRatio: 1.5,
                            stretchMode: 'timestretch',
                        },
                    ],
                },
            ],
        });

        expect(
            handleFitClipToBeats.isNoop?.({
                type: 'fitClipToBeats',
                payload: { clipId: 'c1', targetBeats: 8 },
            })
        ).toBe(true);
        expect(
            handleFitClipToBeats.isNoop?.({
                type: 'fitClipToBeats',
                payload: { clipId: 'c1', targetBeats: 8 },
            })
        ).toBe(false);
    });

    it('is undoable', () => {
        expect(handleFitClipToBeats.undoable).toBe(true);
    });
});
