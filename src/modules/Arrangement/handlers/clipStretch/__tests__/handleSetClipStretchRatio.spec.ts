import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipStretchRatio } from '../handleSetClipStretchRatio';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setClipStretchRatio: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/setClipStretchRatio', () => ({
    setClipStretchRatio: mocks.setClipStretchRatio,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetClipStretchRatio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.setClipStretchRatio.mockReturnValue(true);
    });

    it('executes setClipStretchRatio with the provided payload', () => {
        void handleSetClipStretchRatio.execute({
            type: 'setClipStretchRatio',
            payload: { clipId: 'c1', ratio: 1.5 },
        });

        expect(mocks.setClipStretchRatio).toHaveBeenCalledWith('c1', 1.5);
    });

    it('provides a description reflecting the ratio', () => {
        const desc = handleSetClipStretchRatio.describe({
            type: 'setClipStretchRatio',
            payload: { clipId: 'c1', ratio: 1.5 },
        });
        expect(desc.label).toBe('Set clip c1 stretch ratio to 1.5');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures exact optional stretch state and geometry for undo and redo', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', name: 'Verse Lead', startBeat: 0, endBeat: 4 }],
                },
            ],
        });

        const desc = handleSetClipStretchRatio.describe({
            type: 'setClipStretchRatio',
            payload: { clipId: 'c1', ratio: 1.5 },
        });

        expect(desc.label).toBe('Set clip "Verse Lead" (c1) stretch ratio to 1.5');
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipStretchState',
            payload: {
                clipId: 'c1',
                expected: {
                    startBeat: 0,
                    endBeat: 4,
                    mode: { present: false, value: 'off' },
                    ratio: { present: true, value: 1.5 },
                },
                replacement: {
                    startBeat: 0,
                    endBeat: 4,
                    mode: { present: false, value: 'off' },
                    ratio: { present: false, value: 1 },
                },
            },
        });
        expect(desc.redoAction).toEqual({
            type: 'restoreClipStretchState',
            payload: {
                clipId: 'c1',
                expected: {
                    startBeat: 0,
                    endBeat: 4,
                    mode: { present: false, value: 'off' },
                    ratio: { present: false, value: 1 },
                },
                replacement: {
                    startBeat: 0,
                    endBeat: 4,
                    mode: { present: false, value: 'off' },
                    ratio: { present: true, value: 1.5 },
                },
            },
        });
    });

    it('recognizes the current effective ratio as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, stretchRatio: 1.5 }] }],
        });
        const action = { type: 'setClipStretchRatio' as const, payload: { clipId: 'c1', ratio: 1.5 } };

        expect(handleSetClipStretchRatio.isNoop?.(action)).toBe(true);
    });

    it('is undoable', () => {
        expect(handleSetClipStretchRatio.undoable).toBe(true);
    });
});
